'use strict';
// Разрешаем клиенту управлять другими устройствами.
//
// Синхронизация между устройствами у клиента своя, но себя он объявляет
// как «могу играть, но не могу управлять». Переключаем второй признак —
// тогда с компьютера можно управлять телефоном и колонкой.

const fs = require('fs/promises');
const path = require('path');

const CHUNKS_DIR = 'app/_next/static/chunks';
const ANCHOR = /can_be_remote_controller:!1/;

module.exports = {
  id: 'remote-control',

  async findFiles(root) {
    const dir = path.join(root, CHUNKS_DIR);
    const hits = [];

    const walk = async (current) => {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.js')) {
          if (ANCHOR.test(await fs.readFile(full, 'utf8'))) hits.push(full);
        }
      }
    };

    await walk(dir);
    return hits;
  },

  apply(code) {
    if (!ANCHOR.test(code)) return null;
    return code.replace(/can_be_remote_controller:!1/g, 'can_be_remote_controller:!0');
  },
};
