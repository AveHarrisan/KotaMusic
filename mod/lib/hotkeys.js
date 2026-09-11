'use strict';
// Глобальные горячие клавиши: работают, даже когда окно клиента свёрнуто.

const { app, globalShortcut, BrowserWindow } = require('electron');

const settings = require('./settings');
const log = require('./log');

// Сочетания намеренно с Ctrl+Alt: одиночные мультимедийные клавиши
// клиент обрабатывает сам, перехватывать их незачем.
const DEFAULTS = {
  'Control+Alt+Space': 'play',
  'Control+Alt+Right': 'next',
  'Control+Alt+Left': 'previous',
  'Control+Alt+Up': 'volumeUp',
  'Control+Alt+Down': 'volumeDown',
  'Control+Alt+L': 'like',
};

function send(action) {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;

  log.info('Горячая клавиша:', action);
  window.webContents.send('kotamusic:action', action);
}

function unregister() {
  globalShortcut.unregisterAll();
}

function register() {
  unregister();
  if (!settings.get().hotkeys) return;

  const busy = [];
  for (const [combination, action] of Object.entries(DEFAULTS)) {
    // Сочетание может быть занято другой программой — это не ошибка,
    // просто сообщаем и продолжаем.
    const ok = globalShortcut.register(combination, () => send(action));
    if (!ok) busy.push(combination);
  }

  const total = Object.keys(DEFAULTS).length;
  log.info(`Горячие клавиши: зарегистрировано ${total - busy.length} из ${total}`);
  if (busy.length) log.warn('Сочетания заняты другой программой:', busy.join(', '));
}

function start() {
  if (app.isReady()) register();
  else app.once('ready', register);

  settings.onChange((now, before) => {
    if (now.hotkeys !== before.hotkeys) register();
  });

  app.on('will-quit', unregister);
}

module.exports = { start, DEFAULTS };
