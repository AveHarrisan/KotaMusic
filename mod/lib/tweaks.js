'use strict';
// Мелкие улучшения клиента: масштаб, папка кеша, запрет засыпания экрана.

const path = require('path');
const { app, BrowserWindow, powerSaveBlocker } = require('electron');

const settings = require('./settings');
const log = require('./log');

let blockerId = null;

/** Кеш клиента может весить гигабайты — его полезно уносить с системного диска. */
function applyCacheDir() {
  const dir = settings.get().cacheDir;
  if (!dir) return;

  // Только до готовности приложения: позже Chromium уже открыл кеш.
  if (app.isReady()) {
    return log.warn('Папку кеша меняем только при запуске — перезапустите клиент');
  }

  app.commandLine.appendSwitch('disk-cache-dir', path.resolve(dir));
  log.info('Папка кеша:', dir);
}

function applyZoom() {
  const percent = Number(settings.get().zoom) || 100;

  // Масштаб касается только окна клиента: свои окна мода рисуются
  // в своих размерах, их сжимать незачем.
  const windows = BrowserWindow.getAllWindows().filter(
    (window) => window.getTitle?.() !== 'KotaMusic'
  );

  for (const window of windows) {
    // Electron считает масштаб множителем, а людям привычнее проценты.
    window.webContents.setZoomFactor(percent / 100);
  }

  if (windows.length) log.info(`Масштаб интерфейса: ${percent}%`);
}

/** Пока играет музыка, экран гасить не нужно. */
function applySleepBlock(isPlaying) {
  const wanted = settings.get().preventSleep && isPlaying;

  if (wanted && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
    log.info('Засыпание экрана приостановлено');
    return;
  }

  if (!wanted && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
    log.info('Засыпание экрана разрешено');
  }
}

function start() {
  applyCacheDir();

  const onReady = () => {
    applyZoom();

    // Клиент восстанавливает свой масштаб при загрузке страницы —
    // возвращаем свой после каждой навигации.
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.on('did-finish-load', applyZoom);
    }
  };

  if (app.isReady()) onReady();
  else app.once('ready', () => setTimeout(onReady, 1000));

  settings.onChange((now, before) => {
    if (now.zoom !== before.zoom) applyZoom();
    if (now.preventSleep !== before.preventSleep) applySleepBlock(false);
  });
}

module.exports = { start, applySleepBlock };
