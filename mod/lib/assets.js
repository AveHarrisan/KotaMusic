'use strict';
// Свои картинки.
//
// Часть системных вызовов (иконки кнопок на панели задач) читает файлы
// мимо Electron и внутрь app.asar заглянуть не может. Поэтому при запуске
// раскладываем свои файлы рядом с настройками и работаем уже с ними —
// тогда сам архив остаётся единственным файлом, который надо подменить
// при обновлении.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const branding = require('../branding');
const log = require('./log');

const SOURCE = path.join(__dirname, '..', 'assets');

let target = null;

/** Папка с разложенными файлами; раскладываем один раз на версию мода. */
function dir() {
  if (target) return target;

  target = path.join(app.getPath('userData'), 'kotamusic-assets', branding.version);

  try {
    fs.mkdirSync(target, { recursive: true });

    for (const name of fs.readdirSync(SOURCE)) {
      const to = path.join(target, name);
      const from = path.join(SOURCE, name);

      if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
      fs.copyFileSync(from, to);
    }
  } catch (e) {
    log.warn('Не удалось разложить картинки:', e.message);
  }

  return target;
}

const file = (name) => path.join(dir(), name);

module.exports = { dir, file };
