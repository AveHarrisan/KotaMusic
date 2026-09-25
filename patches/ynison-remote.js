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

// Клиент спрашивает эксперименты двумя способами, и оба надо накрыть:
// getExperiment отдаёт описание опыта, checkExperiment сверяет его группу
// с ожидаемой. Ynison ходит именно через второй.
//
// ⚠️За тело checkExperiment не цепляемся: в 5.121 Яндекс его переписал
// (было `let r=e.experiments[t]`, стало `let i=e.experiments,{…}`), и
// врезка молча перестала ложиться. Заголовок метода вида `(a,b){` бывает
// только у определения — вызовы идут со строкой вторым аргументом.
const ANCHOR = /getExperiment\((\w+)\)\{var (\w+);/;
const CHECK = /checkExperiment\((\w+),(\w+)\)\{/;

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
          const code = await fs.readFile(full, 'utf8');
          if (ANCHOR.test(code) || CHECK.test(code)) hits.push(full);
        }
      }
    };

    await walk(dir);
    return hits;
  },

  apply(code) {
    if (!ANCHOR.test(code) && !CHECK.test(code)) return null;

    const on = `$1==="${NAME}"&&document.documentElement.dataset.kmYnison==="1"`;

    let patched = code;

    // «group» смотрит одна проверка клиента, «value.enabled» — другая,
    // поэтому отвечаем сразу в обоих видах.
    patched = patched.replace(
      new RegExp(ANCHOR, 'g'),
      'getExperiment($1){' +
        `if(${on})` +
        'return{group:"on",value:{enabled:!0}};' +
        'var $2;'
    );

    // А здесь клиент спрашивает «этот опыт в такой-то группе?» — для
    // Ynison он ждёт «on».
    patched = patched.replace(
      new RegExp(CHECK, 'g'),
      'checkExperiment($1,$2){' + `if(${on})return $2==="on";`
    );

    return patched === code ? null : patched;
  },
};
