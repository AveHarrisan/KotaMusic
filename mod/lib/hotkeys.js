'use strict';
// Глобальные горячие клавиши: работают, даже когда окно клиента свёрнуто.

const { app, globalShortcut } = require('electron');

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
  if (action === 'miniplayer') {
    log.info('Горячая клавиша: мини-плеер');
    return require('./miniplayer').toggle();
  }

  log.info('Горячая клавиша:', action);
  require('./player').perform(action);
}

function unregister() {
  globalShortcut.unregisterAll();
}

function register() {
  unregister();

  // Клавиша мини-плеера задаётся пользователем и по умолчанию пуста,
  // поэтому живёт отдельно от общего набора.
  const combinations = { ...(settings.get().hotkeys ? DEFAULTS : {}) };
  const custom = settings.get().miniplayerHotkey?.trim();
  if (custom) combinations[custom] = 'miniplayer';

  if (!Object.keys(combinations).length) return;

  const busy = [];
  for (const [combination, action] of Object.entries(combinations)) {
    // Сочетание может быть занято другой программой — это не ошибка,
    // просто сообщаем и продолжаем.
    let ok = false;
    try {
      ok = globalShortcut.register(combination, () => send(action));
    } catch (e) {
      log.warn(`Сочетание «${combination}» не подходит:`, e.message);
    }
    if (!ok) busy.push(combination);
  }

  const total = Object.keys(combinations).length;
  log.info(`Горячие клавиши: зарегистрировано ${total - busy.length} из ${total}`);
  if (busy.length) log.warn('Сочетания заняты другой программой:', busy.join(', '));
}

function start() {
  if (app.isReady()) register();
  else app.once('ready', register);

  settings.onChange((now, before) => {
    if (now.hotkeys !== before.hotkeys || now.miniplayerHotkey !== before.miniplayerHotkey) {
      register();
    }
  });

  app.on('will-quit', unregister);
}

module.exports = { start, DEFAULTS };
