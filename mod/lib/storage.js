'use strict';
// Своя папка для данных клиента: кеш, скачанное в клиенте, вход в аккаунт.
//
// Клиент держит всё это в папке данных приложения на системном диске.
// Если музыки скачано много, места там не остаётся, поэтому даём выбрать
// другой диск. Путь задаётся ДО готовности приложения — позже Electron
// его уже не примет.

const fs = require('fs');
const path = require('path');
const { app, dialog, ipcMain } = require('electron');

const settings = require('./settings');
const log = require('./log');

// Эти файлы к кешу не относятся и должны остаться на месте: настройки
// клиента, отметка обновлений и журналы.
const KEEP = ['config.json', '.updaterId', 'logs'];

/** Куда клиент складывает данные сейчас. */
const current = () => app.getPath('sessionData');

/** Папка, выбранная человеком, вместе с именем клиента внутри. */
function chosen() {
  const dir = settings.get().cacheDir;
  return dir ? path.join(dir, app.getName()) : null;
}

/**
 * Переносит данные на новое место. Копируем, а не двигаем: если на полпути
 * что-то пойдёт не так, прежняя папка останется целой.
 */
function moveData(from, to) {
  if (!fs.existsSync(from) || path.resolve(from) === path.resolve(to)) return;

  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: (source) => !KEEP.some((name) => source.endsWith(name)),
  });
}

/** Применяет выбранную папку. Вызывается до готовности приложения. */
function applyPath() {
  const target = chosen();
  const base = app.getPath('userData');

  try {
    if (target) {
      if (path.resolve(current()) === path.resolve(target)) return;

      const before = current();
      app.setPath('sessionData', target);
      moveData(before, target);
      log.info('Папка данных клиента:', target);
      return;
    }

    // Настройку выключили — возвращаем всё на место.
    if (path.resolve(current()) !== path.resolve(base)) {
      const before = current();
      app.setPath('sessionData', base);
      moveData(before, base);
      log.info('Папка данных клиента возвращена:', base);
    }
  } catch (e) {
    log.error('Папку данных сменить не вышло:', e.message);
    app.setPath('sessionData', base);
  }
}

/** Сколько занимает папка: считаем размеры файлов внутри. */
function sizeOf(dir) {
  let total = 0;

  const walk = (place) => {
    let entries = [];
    try {
      entries = fs.readdirSync(place, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(place, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* файл занят клиентом — пропускаем */
        }
      }
    }
  };

  walk(dir);
  return total;
}

function start() {
  ipcMain.handle('kotamusic:cache:info', () => ({
    dir: current(),
    size: sizeOf(current()),
  }));

  ipcMain.handle('kotamusic:cache:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Где держать данные клиента',
      defaultPath: settings.get().cacheDir || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths.length) return null;

    settings.set({ cacheDir: result.filePaths[0] });
    return result.filePaths[0];
  });
}

module.exports = { start, applyPath, sizeOf };
