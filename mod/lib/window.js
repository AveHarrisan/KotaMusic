'use strict';
// Поведение окна и системные мелочи: трей вместо закрытия, автозапуск,
// старт свёрнутым.
//
// Своего значка в трее не заводим — он у клиента уже есть, со своим меню
// и восстановлением окна по щелчку. Нам остаётся не дать окну закрыться.

const { app, BrowserWindow } = require('electron');

const branding = require('../branding');
const settings = require('./settings');
const log = require('./log');

// Человек действительно выходит из программы: через меню трея, горячие
// клавиши системы или перезапуск. Тогда окно закрываем по-настоящему.
let quitting = false;

/** Окна мода (мини-плеер) трогать нельзя — они закрываются как обычно. */
const isClientWindow = (window) => window.getTitle?.() !== branding.name;

function attach(window) {
  if (!isClientWindow(window) || window.__kotamusicCloseHooked) return;
  window.__kotamusicCloseHooked = true;

  window.on('close', (event) => {
    if (quitting || !settings.get().closeToTray) return;

    event.preventDefault();
    window.hide();

    // Без этого закрытое окно остаётся в панели задач и выглядит живым.
    window.setSkipTaskbar(true);
  });
}

/** Автозапуск с системой. На Linux у пакетов свои правила — не лезем. */
function applyAutoStart() {
  if (process.platform === 'linux') return;

  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.get().autoStart) });
  } catch (e) {
    log.warn('Автозапуск настроить не вышло:', e.message);
  }
}

/** Запоминаем размер окна клиента и возвращаем его при запуске. */
function rememberSize(window) {
  if (window.__kotamusicSizeHooked) return;
  window.__kotamusicSizeHooked = true;

  window.on('resized', () => {
    if (!settings.get().rememberWindowSize || window.isDestroyed()) return;

    const [width, height] = window.getSize();
    settings.set({ windowSize: { width, height } });
  });
}

function restoreSize(window) {
  const saved = settings.get().windowSize;
  if (!settings.get().rememberWindowSize) return;
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return;

  try {
    window.setSize(Math.max(640, saved.width), Math.max(480, saved.height));
  } catch (e) {
    log.warn('Размер окна вернуть не вышло:', e.message);
  }
}

/** Страница, с которой клиент открывается. */
function openStartupPage(window) {
  const page = String(settings.get().startupPage || '').trim();
  if (!page || page === '/') return;

  // Тот же канал, которым клиент открывает свои ссылки.
  window.webContents.send('desktop:navigation:open-deeplink', page);
  log.info('Стартовая страница:', page);
}

function startMinimized() {
  if (!settings.get().startMinimized) return;

  for (const window of BrowserWindow.getAllWindows()) {
    if (!isClientWindow(window)) continue;

    // Окно клиента показывается не сразу — ждём его готовности, иначе
    // свернём то, чего ещё нет на экране.
    if (window.isVisible()) window.minimize();
    else window.once('ready-to-show', () => window.minimize());
  }

  log.info('Старт свёрнутым');
}

/**
 * Аппаратное ускорение выключается только до готовности приложения,
 * поэтому вызывается из точки входа мода, а не отсюда.
 */
function applyHardwareAcceleration() {
  if (settings.get().hardwareAcceleration !== false) return;

  try {
    app.disableHardwareAcceleration();
    log.info('Аппаратное ускорение выключено');
  } catch (e) {
    log.warn('Аппаратное ускорение выключить не вышло:', e.message);
  }
}

function start() {
  app.on('before-quit', () => {
    quitting = true;
  });

  BrowserWindow.getAllWindows().forEach(attach);
  app.on('browser-window-created', (_event, window) => attach(window));

  applyAutoStart();

  settings.onChange((now, before) => {
    if (now.autoStart !== before.autoStart) applyAutoStart();
  });

  const init = () =>
    setTimeout(() => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!isClientWindow(window)) continue;

        rememberSize(window);
        restoreSize(window);
        openStartupPage(window);
      }

      startMinimized();
    }, 1500);

  if (app.isReady()) init();
  else app.once('ready', init);
}

module.exports = { start, applyHardwareAcceleration };
