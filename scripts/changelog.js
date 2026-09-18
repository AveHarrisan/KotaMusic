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
function sameOrInside(title, version) {
  const head = title.split(/\s|—/)[0];
  if (head === String(version)) return true;

  // Несколько версий подряд бывает удобнее описать одним разделом:
  // «1.2.8–1.2.16». Тогда подходит любая версия из промежутка.
  const range = head.split(/[–-]/);
  if (range.length !== 2) return false;

  const number = (value) =>
    String(value)
      .split('.')
      .map((part) => Number(part) || 0)
      .reduce((total, part) => total * 1000 + part, 0);

  const asked = number(version);
  return asked >= number(range[0]) && asked <= number(range[1]);
}

function notesFor(version) {
  if (!fs.existsSync(FILE)) return '';

  const text = fs.readFileSync(FILE, 'utf8');
  const section = sections(text).find((s) => sameOrInside(s.title, version));

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
