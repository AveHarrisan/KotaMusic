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

  const init = () => setTimeout(startMinimized, 1000);

  if (app.isReady()) init();
  else app.once('ready', init);
}

module.exports = { start, applyHardwareAcceleration };
