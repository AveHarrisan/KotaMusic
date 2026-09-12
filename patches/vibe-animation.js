'use strict';
// Отключение живой анимации Моей Волны.
//
// Клиент рисует Волну в WebGL и сам следит за частотой кадров: если она
// проседает три раза подряд, он переходит на облегчённую анимацию, а
// потом и на статичную заглушку. Ту же заглушку включаем по настройке —
// на слабых машинах анимация ест больше, чем сама музыка.
//
// Признак берём из DOM, а не из глобальной переменной: наш код живёт в
// preload, у страницы своя область видимости, и общего у них — только
// дерево документа.

const fs = require('fs/promises');
const path = require('path');

const CHUNKS_DIR = 'app/_next/static/chunks';

// Место, где клиент решает, рисовать анимацию или показать заглушку:
// заглушка включается, когда просела частота кадров, включён облегчённый
// режим или в среде нет Worker. Добавляем в это «или» свой признак.
const ANCHOR = /(\w+)=(\w+)\|\|(\w+)\|\|"undefined"==typeof Worker/;

module.exports = {
  id: 'vibe-animation',

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

    return code.replace(
      new RegExp(ANCHOR, 'g'),
      '$1=document.documentElement.dataset.kmLiteVibe==="1"||$2||$3||"undefined"==typeof Worker'
    );
  },
};
