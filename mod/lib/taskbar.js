'use strict';
// Кнопки управления в миниатюре окна на панели задач Windows.
// На других системах такого механизма нет — модуль просто молчит.

const { app, BrowserWindow, nativeImage } = require('electron');

const settings = require('./settings');
const assets = require('./assets');
const log = require('./log');

// Системный вызов читает файл мимо Electron и внутрь архива не заглянет,
// поэтому берём картинку из разложенной папки.
const iconPath = (name) => assets.file(`${name}.png`);

function icon(name) {
  const image = nativeImage.createFromPath(iconPath(name));
  if (image.isEmpty()) log.warn('Иконка не прочиталась:', iconPath(name));
  return image;
}

let isPlaying = false;

function send(window, action) {
  log.info('Кнопка панели задач:', action);
  require('./player').perform(action);
}

/** Набор кнопок зависит от того, играет ли музыка. */
function buttons(window) {
  return [
    {
      tooltip: 'Предыдущий трек',
      icon: icon('previous'),
      click: () => send(window, 'previous'),
    },
    {
      tooltip: isPlaying ? 'Пауза' : 'Воспроизвести',
      icon: icon(isPlaying ? 'pause' : 'play'),
      click: () => send(window, 'play'),
    },
    {
      tooltip: 'Следующий трек',
      icon: icon('next'),
      click: () => send(window, 'next'),
    },
  ];
}

function apply() {
  if (process.platform !== 'win32') return;

  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;

  const ok = window.setThumbarButtons(settings.get().taskbarButtons ? buttons(window) : []);
  return ok;
}

/** Значок на кнопке панели задач подсказывает состояние без раскрытия окна. */
function updateOverlay() {
  if (process.platform !== 'win32') return;

  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;

  if (!settings.get().taskbarButtons || !isPlaying) return window.setOverlayIcon(null, '');
  window.setOverlayIcon(icon('play'), 'Играет');
}

function setPlaying(value) {
  if (value === isPlaying) return;

  isPlaying = value;
  apply();
  updateOverlay();
}

function start() {
  const init = () => {
    const ok = apply();
    const size = icon('play').getSize();
    log.info(
      `Кнопки панели задач: ${ok ? 'установлены' : 'недоступны'}; ` +
        `иконка ${size.width}x${size.height}`
    );
  };

  if (app.isReady()) setTimeout(init, 1500);
  else app.once('ready', () => setTimeout(init, 1500));

  settings.onChange((now, before) => {
    if (now.taskbarButtons !== before.taskbarButtons) {
      apply();
      updateOverlay();
    }
  });
}

module.exports = { start, setPlaying };
