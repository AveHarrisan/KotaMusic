'use strict';
// Управление этим компьютером с других устройств.
//
// У Яндекса это спрятано за экспериментом WebNextYnisonActivityInterception:
// когда он включён, клиент отдаёт свою очередь воспроизведения общей
// синхронизации и слушается телефона или колонки.
//
// Эксперименты приходят с сервера, поэтому врезаемся в чтение: для одного
// нашего имени отвечаем «включено», если стоит признак на странице.
// Остальные эксперименты не трогаем — чужие опыты Яндекса не наше дело.

const fs = require('fs/promises');
const path = require('path');

const CHUNKS_DIR = 'app/_next/static/chunks';
const NAME = 'WebNextYnisonActivityInterception';

// Метод модели экспериментов: возвращает описание опыта по имени.
const ANCHOR = /getExperiment\((\w+)\)\{var (\w+);/;

module.exports = {
  id: 'ynison-remote',

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

    // «group» смотрит одна проверка клиента, «value.enabled» — другая,
    // поэтому отвечаем сразу в обоих видах.
    return code.replace(
      new RegExp(ANCHOR, 'g'),
      'getExperiment($1){' +
        `if($1==="${NAME}"&&document.documentElement.dataset.kmYnison==="1")` +
        'return{group:"on",value:{enabled:!0}};' +
        'var $2;'
    );
  },
};
