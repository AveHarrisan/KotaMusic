'use strict';
// Патчи, накладываемые на код клиента.
// Каждый патч обязан уметь сказать, применился он или нет, — по этому
// сборка решает, выкладывать релиз или звать человека.

/**
 * @typedef {Object} Patch
 * @property {string} id        короткое имя для логов и отчётов
 * @property {string} file      файл внутри asar
 * @property {(code: string, ctx: object) => string|null} apply
 *           возвращает новый код либо null, если точка врезки не найдена
 */

/** @type {Patch[]} */
const patches = [
  require('./settings-ui'),
  require('./remote-control'),
  require('./preload'),
  {
    id: 'devtools',
    file: 'index.js',
    apply(code) {
      // В клиенте инструменты разработчика выключены при создании окна.
      const re = /const\s+webPreferences\s*=\s*\{/;
      if (!re.test(code)) return null;
      return code.replace(re, 'const webPreferences = { devTools: true,');
    },
  },
  {
    id: 'bootstrap',
    file: 'index.js',
    apply(code) {
      // Точка входа мода: подключаем свой слой первым делом.
      if (code.includes('kotamusic/bootstrap')) return code; // уже наложен
      if (!code.startsWith("'use strict';")) return null;
      return code.replace(
        "'use strict';",
        "'use strict';require('./kotamusic/bootstrap.js');"
      );
    },
  },
];

module.exports = { patches };
