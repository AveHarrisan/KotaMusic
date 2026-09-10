'use strict';
// Подключаем наблюдатель за панелью плеера к preload клиента.
//
// Окно запускается с sandbox: true, поэтому подгрузить свой файл через
// require из preload нельзя — Electron даёт там только 'electron' и пару
// встроенных модулей. Поэтому вшиваем код наблюдателя прямо в preload.

const fs = require('fs/promises');
const path = require('path');

const RENDERER_DIR = path.join(__dirname, '..', 'mod', 'renderer');
const MARK = '/* KotaMusic:renderer */';

module.exports = {
  id: 'preload',
  file: 'preload.js',

  async prepare() {
    // Каждый файл — в своей области видимости, чтобы одинаковые имена
    // переменных в разных сценариях не сталкивались.
    const files = (await fs.readdir(RENDERER_DIR)).filter((f) => f.endsWith('.js')).sort();

    this.scripts = [];
    for (const file of files) {
      const code = await fs.readFile(path.join(RENDERER_DIR, file), 'utf8');
      this.scripts.push({ file, code });
    }
  },

  apply(code) {
    if (code.includes(MARK)) return code; // уже наложен
    if (!code.startsWith("'use strict';")) return null;

    const inlined =
      MARK +
      this.scripts
        .map(
          ({ file, code }) =>
            `try{(function(){${code}})()}` +
            `catch(e){console.error('[KotaMusic] ${file} не запустился',e)}`
        )
        .join('');

    return code.replace("'use strict';", `'use strict';${inlined}`);
  },
};
