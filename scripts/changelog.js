'use strict';
// Список правок для релиза и для окна обновления.
//
// Держим его в CHANGELOG.md руками: из заголовков коммитов осмысленного
// текста не выходит, а человек всё равно должен решить, о чём стоит
// сказать вслух.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'CHANGELOG.md');

/** Разделы файла: заголовок версии → его строки. */
function sections(text) {
  const found = [];
  let current = null;

  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);

    if (heading) {
      current = { title: heading[1], lines: [] };
      found.push(current);
      continue;
    }

    if (current) current.lines.push(line);
  }

  return found;
}

/**
 * Правки нужной версии. Раздел ищем по номеру в начале заголовка, чтобы
 * дата рядом с ним ничему не мешала.
 */
function notesFor(version) {
  if (!fs.existsSync(FILE)) return '';

  const text = fs.readFileSync(FILE, 'utf8');
  const section = sections(text).find((s) => s.title.split(/\s|—/)[0] === String(version));

  if (!section) return '';

  return section.lines.join('\n').trim();
}

/** Правки одной строкой на пункт — окну обновления разметка не нужна. */
function itemsFor(version) {
  const notes = notesFor(version);
  if (!notes) return [];

  const items = [];

  for (const line of notes.split('\n')) {
    const start = line.match(/^-\s+(.*)$/);

    if (start) {
      items.push(start[1].trim());
      continue;
    }

    // Продолжение пункта на следующей строке — дописываем к последнему.
    const text = line.trim();
    if (text && items.length) items[items.length - 1] += ` ${text}`;
  }

  return items;
}

module.exports = { notesFor, itemsFor };

if (require.main === module) {
  const version = process.argv[2] || require('../package.json').version;
  const notes = notesFor(version);

  if (!notes) {
    console.error(`В CHANGELOG.md нет раздела для версии ${version}`);
    process.exit(1);
  }

  console.log(notes);
}
