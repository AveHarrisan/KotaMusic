'use strict';
// Мини-плеер: маленькое окно поверх остальных с обложкой, названием
// и управлением. Живёт отдельно от клиента и получает всё по каналам.

const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const settings = require('./settings');
const log = require('./log');

const WIDTH = 340;
const HEIGHT = 108;
const MARGIN = 24;

let window = null;
let lastTrack = null;
let lastPosition = null;

/** Правый нижний угол экрана — привычное место для такого окна. */
function corner() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIDTH - MARGIN,
    y: workArea.y + workArea.height - HEIGHT - MARGIN,
  };
}

function create() {
  if (window && !window.isDestroyed()) return window;

  const position = corner();

  window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: position.x,
    y: position.y,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1a1a1a',
    title: 'KotaMusic',
    webPreferences: {
      // Своё окно, свой код — здесь песочница только мешает.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Своё окно масштабу клиента не подчиняется.
  window.webContents.on('did-finish-load', () => window.webContents.setZoomFactor(1));
  window.loadFile(path.join(__dirname, '..', 'miniplayer', 'index.html'));

  window.on('closed', () => {
    window = null;
  });

  return window;
}

const alive = () => window && !window.isDestroyed();

function show() {
  create().show();
  push();
}

function hide() {
  if (alive()) window.close();
  window = null;
}

function toggle() {
  const wanted = !alive();
  settings.set({ miniplayer: wanted });
  log.info('Мини-плеер:', wanted ? 'показан' : 'скрыт');
}

/** Отправляет окну то, что знает о треке и как его показывать. */
function push() {
  if (!alive()) return;

  window.webContents.send('kotamusic:miniplayer:options', {
    seek: settings.get().miniplayerSeek,
    volume: settings.get().miniplayerVolume,
    close: settings.get().miniplayerClose,
  });

  window.webContents.send('kotamusic:miniplayer:track', lastTrack);
}

function setTrack(track) {
  lastTrack = track;
  push();
}

function setPosition(tick) {
  lastPosition = tick;
  if (!alive()) return;
  window.webContents.send('kotamusic:miniplayer:tick', tick);
}

function start() {
  ipcMain.on('kotamusic:miniplayer:ready', () => push());

  // Закрытие окна — это выключение мини-плеера, чтобы он не возвращался
  // сам при следующем запуске клиента.
  ipcMain.on('kotamusic:miniplayer:close', () => {
    log.info('Мини-плеер закрыт');
    settings.set({ miniplayer: false });
  });

  ipcMain.on('kotamusic:miniplayer:action', (_event, action) => {
    log.info('Мини-плеер:', action);
    require('./player').perform(action);
  });

  settings.onChange((now, before) => {
    if (now.miniplayer !== before.miniplayer) return now.miniplayer ? show() : hide();

    // Внешний вид окна меняется без перезапуска.
    push();
  });

  const init = () => {
    if (settings.get().miniplayer) show();
  };

  if (app.isReady()) init();
  else app.once('ready', init);
}

module.exports = { start, toggle, setTrack, setPosition, show, hide };
