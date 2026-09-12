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
  require('./vibe-animation'),
  require('./ynison-remote'),
  require('./preload'),
  {
    // Обновлениями клиента распоряжается мод: иначе клиент обновит себя
    // сам и сотрёт мод, как это было у прежних модификаций. Решение
    // остаётся за человеком — признак ставит сам мод по настройке.
    id: 'hold-updates',
    file: 'index.js',
    apply(code) {
      const anchor = `  async check() {
    if (this.updateStatus === UpdateStatus.INSTALLING) {`;

      if (code.includes('__kotamusicHoldUpdates')) return code; // уже наложен
      if (!code.includes(anchor)) return null;

      return code.replace(
        anchor,
        `  async check() {
    if (globalThis.__kotamusicHoldUpdates) return;
    if (this.updateStatus === UpdateStatus.INSTALLING) {`
      );
    },
  },
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
