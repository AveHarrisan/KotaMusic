'use strict';
// Мини-плеер: маленькое окно поверх остальных с обложкой, названием
// и управлением. Живёт отдельно от клиента и получает всё по каналам.

const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const settings = require('./settings');
const log = require('./log');

const WIDTH = 340;
const HEIGHT = 108;

// Компактный вид не только ниже, но и уже — иначе окно выглядит
// неестественно вытянутым.
const COMPACT_WIDTH = 250;
const COMPACT_HEIGHT = 76;
const MARGIN = 24;

// Прозрачность зафиксированного окна: видно, но не мешает.
const LOCKED_OPACITY = 0.55;

let window = null;
let lastTrack = null;
let lastPosition = null;
let unlockTimer = null;
let unlockUntil = 0;

// Когда мониторы выключаются, Windows сгоняет окна на оставшийся экран.
// Это не человек перетащил — запоминать такое место нельзя, а после
// возвращения мониторов окно нужно вернуть обратно.
let displaysChangedAt = 0;
let restoreTimer = null;

const DISPLAY_SETTLE_MS = 8000;
const RESTORE_DELAY_MS = 2500;

/** Сохранённое место окна, если оно всё ещё помещается на экране. */
function savedPosition() {
  const saved = settings.get().miniplayerPosition;
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;

  // Монитор могли отключить — тогда окно уехало бы за пределы экрана.
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    return (
      saved.x + currentWidth() > workArea.x &&
      saved.y + currentHeight() > workArea.y &&
      saved.x < workArea.x + workArea.width &&
      saved.y < workArea.y + workArea.height
    );
  });

  return visible ? saved : null;
}

/** Правый нижний угол экрана — привычное место для такого окна. */
function corner() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - currentWidth() - MARGIN,
    y: workArea.y + workArea.height - currentHeight() - MARGIN,
  };
}

const compact = () => Boolean(settings.get().miniplayerCompact);

/** Размер, до которого человек растянул окно, если он ещё годится. */
function savedSize() {
  const saved = settings.get().miniplayerSize;
  if (!settings.get().miniplayerResizable) return null;
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;

  return saved;
}

const currentWidth = () => savedSize()?.width || (compact() ? COMPACT_WIDTH : WIDTH);
const currentHeight = () => savedSize()?.height || (compact() ? COMPACT_HEIGHT : HEIGHT);

function create() {
  if (window && !window.isDestroyed()) return window;

  const position = savedPosition() || corner();

  window = new BrowserWindow({
    width: currentWidth(),
    height: currentHeight(),
    x: position.x,
    y: position.y,
    frame: false,
    resizable: Boolean(settings.get().miniplayerResizable),
    maximizable: false,
    minimizable: false,
    skipTaskbar: !settings.get().miniplayerTaskbar,
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

  // Запоминаем, куда человек перетащил окно: в следующий раз оно
  // откроется там же.
  const remember = () => {
    if (!alive()) return;

    // Сразу после перестановки экранов окно двигает система — её выбор
    // не запоминаем, иначе потеряем место, куда его поставил человек.
    if (Date.now() - displaysChangedAt < DISPLAY_SETTLE_MS) return;

    const [x, y] = window.getPosition();
    settings.set({ miniplayerPosition: { x, y } });
  };

  window.on('moved', remember);

  // Размер запоминаем отдельно: он нужен, только когда окно тянут за край.
  window.on('resized', () => {
    if (!alive() || !settings.get().miniplayerResizable) return;

    const [width, height] = window.getSize();
    settings.set({ miniplayerSize: { width, height } });
  });

  window.on('close', remember);
  window.on('closed', () => {
    window = null;
  });

  window.webContents.on('did-finish-load', () => applyLock());

  return window;
}

/**
 * Зафиксированное окно не ловит мышь и становится прозрачным.
 * Временная разблокировка снимает это на несколько секунд.
 */
function applyLock() {
  if (!alive()) return;

  const locked = settings.get().miniplayerLocked && Date.now() >= unlockUntil;

  window.setIgnoreMouseEvents(locked, { forward: true });
  window.setOpacity(locked ? LOCKED_OPACITY : 1);

  window.webContents.send('kotamusic:miniplayer:lock', {
    locked,
    // Сколько секунд осталось до обратной фиксации.
    remaining: locked ? 0 : Math.max(0, Math.ceil((unlockUntil - Date.now()) / 1000)),
  });
}

/** Снимает фиксацию на время, заданное в настройках. */
function unlockTemporarily() {
  if (!settings.get().miniplayerLocked) return;
  if (!alive()) show();

  startUnlock();
  log.info(`Фиксация снята на ${settings.get().miniplayerUnlockSeconds} с`);
}

/**
 * Продлевает уже снятую фиксацию. Само по себе движение мыши её не снимает:
 * при фиксации система всё равно передаёт окну движения курсора, и иначе
 * окно разблокировалось бы от одного проезда мышью мимо.
 */
function extendUnlock() {
  if (Date.now() >= unlockUntil) return;
  startUnlock();
}

function startUnlock() {
  if (!settings.get().miniplayerLocked) return;

  const seconds = Math.max(5, Number(settings.get().miniplayerUnlockSeconds) || 30);
  unlockUntil = Date.now() + seconds * 1000;

  applyLock();

  clearInterval(unlockTimer);
  unlockTimer = setInterval(() => {
    if (Date.now() >= unlockUntil) {
      clearInterval(unlockTimer);
      unlockTimer = null;
    }
    applyLock();
  }, 1000);
}

const alive = () => window && !window.isDestroyed();

/** Возвращает окно туда, где его оставил человек. */
function restorePosition() {
  if (!alive()) return;

  const saved = savedPosition();
  if (!saved) return;

  const [x, y] = window.getPosition();
  if (x === saved.x && y === saved.y) return;

  window.setPosition(saved.x, saved.y);
  log.info(`Мини-плеер вернулся на место: ${saved.x}, ${saved.y}`);
}

/**
 * Следим за экранами: их выключение и включение переставляет окна, и
 * своё мы ставим назад сами — система об этом не позаботится.
 */
function watchDisplays() {
  const changed = () => {
    displaysChangedAt = Date.now();

    // Экраны просыпаются не разом: ждём, пока раскладка устоится.
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restorePosition, RESTORE_DELAY_MS);
  };

  screen.on('display-added', changed);
  screen.on('display-removed', changed);
  screen.on('display-metrics-changed', changed);
}

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
    compact: settings.get().miniplayerCompact,
    volumeStep: Math.max(1, Math.min(25, Number(settings.get().volumeStep) || 1)),
  });

  window.webContents.send('kotamusic:miniplayer:track', lastTrack);
}

const hideIdle = () => Boolean(settings.get().miniplayerHideIdle);

function setTrack(track) {
  lastTrack = track;

  // Окно скрываем только само по себе: настройку не трогаем, иначе мод
  // решит, что мини-плеер выключили, и не вернёт его с первым же треком.
  if (settings.get().miniplayer && hideIdle()) {
    if (!track) return hide();
    if (!alive()) return show();
  }

  push();
}

function setPosition(tick) {
  lastPosition = tick;
  if (!alive()) return;
  window.webContents.send('kotamusic:miniplayer:tick', tick);
}

function start() {
  watchDisplays();

  ipcMain.on('kotamusic:miniplayer:ready', () => push());

  // Кнопка в углу страницы: открывает мини-плеер и закрывает его.
  ipcMain.on('kotamusic:miniplayer:show', () => {
    if (alive()) {
      settings.set({ miniplayer: false });
      log.info('Мини-плеер закрыт кнопкой');
      return;
    }

    settings.set({ miniplayer: true });
    log.info('Мини-плеер открыт кнопкой');
  });

  // Закрытие окна — это выключение мини-плеера, чтобы он не возвращался
  // сам при следующем запуске клиента.
  ipcMain.on('kotamusic:miniplayer:close', () => {
    log.info('Мини-плеер закрыт');
    settings.set({ miniplayer: false });
  });

  // Отсчёт продлевают только нажатия: от одного движения мыши
  // над окном фиксация возвращаться не должна.
  ipcMain.on('kotamusic:miniplayer:action', (_event, action) => {
    extendUnlock();
    log.info('Мини-плеер:', action);
    require('./player').perform(action);
  });

  settings.onChange((now, before) => {
    if (now.miniplayer !== before.miniplayer) return now.miniplayer ? show() : hide();

    // Настройку переключили при пустом плеере — окно должно пропасть
    // или вернуться сразу, не дожидаясь смены трека.
    if (now.miniplayerHideIdle !== before.miniplayerHideIdle && now.miniplayer) {
      if (now.miniplayerHideIdle && !lastTrack) return hide();
      if (!now.miniplayerHideIdle && !alive()) return show();
    }

    // Эти свойства задаются при создании окна — пересоздаём его.
    if (
      now.miniplayerResizable !== before.miniplayerResizable ||
      now.miniplayerTaskbar !== before.miniplayerTaskbar
    ) {
      if (alive()) {
        hide();
        show();
      }
      return;
    }

    if (now.miniplayerCompact !== before.miniplayerCompact && alive()) {
      // Размер меняем, место сохраняем — окно не должно прыгать.
      const [x, y] = window.getPosition();
      window.setBounds({ x, y, width: currentWidth(), height: currentHeight() });
    }

    if (now.miniplayerLocked !== before.miniplayerLocked) {
      unlockUntil = 0;
      applyLock();
    }

    // Внешний вид окна меняется без перезапуска.
    push();
  });

  const init = () => {
    if (!settings.get().miniplayer) return;

    // При запуске трека ещё нет: с этой настройкой окно ждёт первого.
    if (hideIdle()) return;

    show();
  };

  if (app.isReady()) init();
  else app.once('ready', init);
}

module.exports = { start, toggle, setTrack, setPosition, show, hide, unlockTemporarily };
