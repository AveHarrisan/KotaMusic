'use strict';
// Настройки, которые начинают действовать только после перезапуска.
//
// Клиент читает их при старте: аппаратное ускорение выключается до
// готовности приложения, а управление с других устройств клиент решает
// при подключении к синхронизации. Поэтому просто спрашиваем, можно ли
// перезапустить сейчас, — иначе человек переключит тумблер и будет ждать
// от него чуда.

const { app, dialog, BrowserWindow } = require('electron');

const branding = require('../branding');
const settings = require('./settings');
const log = require('./log');

// Настройка → о чём спросить.
const NEEDS_RESTART = {
  ynisonRemote: 'Управление этим компьютером с других устройств',
  hardwareAcceleration: 'Аппаратное ускорение',
  startupPage: 'Стартовая страница',
  cacheDir: 'Папка данных клиента',
};

let asking = false;

/** Окно клиента: диалог вешаем на него, а не на свой мини-плеер. */
const clientWindow = () =>
  BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.getTitle?.() !== branding.name
  );

async function ask(title) {
  if (asking) return;
  asking = true;

  try {
    const window = clientWindow();

    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: branding.name,
      message: 'Нужен перезапуск',
      detail:
        `Настройка «${title}» начнёт действовать после перезапуска клиента.\n\n` +
        'Перезапустить сейчас? Музыка продолжит играть с того же места.',
    });

    if (answer.response !== 0) return log.info('Перезапуск отложен:', title);

    log.info('Перезапуск по настройке:', title);

    app.relaunch();

    // Именно exit: клиент умеет прятаться в область уведомлений, а нам
    // нужно, чтобы он действительно вышел.
    app.exit(0);
  } catch (e) {
    log.warn('Спросить о перезапуске не вышло:', e.message);
  } finally {
    asking = false;
  }
}

function start() {
  settings.onChange((now, before) => {
    for (const [key, title] of Object.entries(NEEDS_RESTART)) {
      if (now[key] === before[key]) continue;

      // Пустая стартовая страница — это «как обычно», перезапуск не нужен.
      if (key === 'startupPage' && !String(now[key] || '').trim()) continue;

      ask(title);
      return;
    }
  });
}

module.exports = { start, NEEDS_RESTART };
