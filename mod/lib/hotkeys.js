'use strict';
// Глобальные горячие клавиши: работают, даже когда окно клиента свёрнуто.

const { app, globalShortcut } = require('electron');

const settings = require('./settings');
const log = require('./log');

// Названия действий для журнала.
const NAMES = {
  play: 'пауза и воспроизведение',
  next: 'следующий трек',
  previous: 'предыдущий трек',
  volumeUp: 'громче',
  volumeDown: 'тише',
  like: 'лайк',
  miniplayer: 'мини-плеер',
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

  // Сочетания задаёт пользователь: пустое значение означает, что
  // клавиши у действия нет.
  const combinations = Object.entries(settings.get().hotkeys || {})
    .map(([action, combination]) => [action, combination?.trim()])
    .filter(([, combination]) => combination);

  if (!combinations.length) return;

  const busy = [];
  for (const [action, combination] of combinations) {
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

  const total = combinations.length;
  log.info(`Горячие клавиши: зарегистрировано ${total - busy.length} из ${total}`);
  if (busy.length) log.warn('Сочетания заняты другой программой:', busy.join(', '));
}

function start() {
  if (app.isReady()) register();
  else app.once('ready', register);

  settings.onChange((now, before) => {
    if (JSON.stringify(now.hotkeys) !== JSON.stringify(before.hotkeys)) register();
  });

  app.on('will-quit', unregister);
}

module.exports = { start, NAMES };
