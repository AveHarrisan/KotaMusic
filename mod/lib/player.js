'use strict';
// Управление воспроизведением.
//
// Для паузы и перемотки используем штатный канал клиента — тот самый,
// которым он сам управляет плеером из меню в трее. Это надёжнее кликов
// по кнопкам: на странице их много, и в разных режимах они разные.

const { BrowserWindow } = require('electron');

const log = require('./log');

const CHANNEL = 'desktop:player:action';

// Набор команд интерфейса клиента: ими он обрабатывает и свои
// горячие клавиши, и команды из меню в трее.
// Штатный канал понимает только перемотку треков. Пауза, громкость
// и лайк через него не проходят — их нажимаем в интерфейсе.
const NATIVE = {
  next: 'MOVE_FORWARD',
  previous: 'MOVE_BACKWARD',
};

let isPlaying = false;

const mainWindow = () =>
  BrowserWindow.getAllWindows().find((window) => window.getTitle?.() !== 'KotaMusic');

function setPlaying(value) {
  isPlaying = Boolean(value);
}

/** Выполняет действие: пауза, треки, громкость, лайк. */
function perform(action) {
  const window = mainWindow();
  if (!window) return;

  if (NATIVE[action]) {
    log.info('Команда плееру:', NATIVE[action]);
    return window.webContents.send(CHANNEL, NATIVE[action]);
  }

  // Остальное — нажатием в интерфейсе.
  window.webContents.send('kotamusic:action', action);
}

module.exports = { perform, setPlaying };
