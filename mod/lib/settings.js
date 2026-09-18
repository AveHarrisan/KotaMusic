'use strict';
// Настройки мода. Лежат рядом с данными клиента, чтобы переживать
// обновления: пересборка мода их не трогает.

const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const branding = require('../branding');
const log = require('./log');

const FILE = 'kotamusic.json';

const DEFAULTS = {
  richPresence: true,
  // 'bar' — полоса с началом и концом (видна в карточке профиля)
  // 'counter' — счётчик времени (виден и в карточке голосового канала)
  progress: branding.discord.progress,
  showButtons: branding.discord.showButtons,
  showTrackInMemberList: branding.discord.modernFields,
  showAlbum: true,
  // Через сколько секунд паузы снимать статус; 0 — сразу.
  pauseClearSeconds: 0,
  discordApplicationId: branding.discord.applicationId,

  // Скачивание треков в обычные файлы.
  downloadDir: '',
  downloadMp3: false,
  downloadLyrics: true,
  downloadCover: true,
  // Альбом и плейлист складывать в свою папку или всё в общую.
  downloadAlbumFolder: true,
  // Спрашивать перед каждым скачиванием, куда класть.
  downloadAsk: false,
  downloadParallel: 3,

  // Своя папка для данных клиента: кеш и скачанное в самом клиенте.
  cacheDir: '',

  // Текст песни: своя панель и запасной источник LRCLib.
  lyricsButton: true,
  // Где человек поставил панель с текстом и какого она размера.
  lyricsPanelBox: null,
  lyricsFontSize: 15,
  lyricsLrclib: true,
  // Кнопка скачивания в панели плеера и подпись с качеством трека.
  downloadButton: true,
  showTrackQuality: true,

  // Мини-плеер поверх других окон.
  miniplayer: false,

  // Что показывать в мини-плеере.
  miniplayerSeek: true,
  miniplayerVolume: true,
  miniplayerClose: true,

  // Компактный вид: то же окно, но ниже и плотнее.
  miniplayerCompact: false,

  // Окно мини-плеера можно тянуть за край, размер запоминается.
  miniplayerResizable: false,
  miniplayerSize: null,

  // Мини-плеер в панели задач: по умолчанию его там нет.
  miniplayerTaskbar: false,

  // Прятать окно, пока играть нечего: вместо надписи «Ничего не играет»
  // на экране не остаётся ничего.
  miniplayerHideIdle: false,

  // Где человек оставил окно в прошлый раз.
  miniplayerPosition: null,

  // Кнопка вызова мини-плеера в заголовке клиента.
  miniplayerButton: true,

  // Подсказку о кнопке показываем только в первый раз.
  hintShown: false,

  // Отметка о разовом возврате настроек после диагностики 10.09.
  presetUndone: false,

  // Зафиксированное окно становится полупрозрачным и не ловит мышь —
  // на него можно только смотреть.
  miniplayerLocked: false,

  // На сколько секунд горячая клавиша снимает фиксацию.
  miniplayerUnlockSeconds: 30,

  // Шаг изменения громкости колесом мыши, в процентах.
  volumeStep: 1,

  // Кнопки управления в миниатюре окна на панели задач Windows.
  taskbarButtons: true,

  // Статичная заставка вместо живой анимации Моей Волны: на слабых
  // машинах она ест больше, чем сама музыка.
  liteVibeAnimation: false,

  // Управлять этим компьютером с телефона и колонки.
  ynisonRemote: false,

  // Внешний вид панели плеера клиента.
  playerAlwaysTimecode: false,
  playerFlatColors: false,
  playerThickBar: false,

  // Окно и система.
  closeToTray: false,
  startupPage: '',
  rememberWindowSize: false,
  windowSize: null,
  autoStart: false,
  startMinimized: false,
  hardwareAcceleration: true,

  // Плашка «сейчас играет» на локальном адресе — для OBS.
  stream: false,
  streamPort: 8462,

  // Как выглядит плашка в кадре.
  streamCover: true,
  streamCoverSize: 56,
  streamBar: true,
  streamTime: false,
  streamFontSize: 16,
  streamWidth: 560,

  // Подложка: 'dark' — тёмная, 'light' — светлая, 'none' — только текст
  // с обводкой, без карточки.
  streamBackground: 'dark',

  // Цвет полосы времени.
  streamAccent: '#ffdb4d',

  // Свои цвета текста. Пока выключено, плашка красит текст сама —
  // под выбранную подложку.
  streamCustomColors: false,
  streamTitleColor: '#ffffff',
  streamArtistColor: '#cccccc',
  streamTimeColor: '#cccccc',

  // Глобальные горячие клавиши: действие → сочетание. Пустая строка
  // означает, что клавиши у действия нет.
  // Сочетания по умолчанию не заданы: пусть каждый выберет удобные ему
  // и не ловит совпадения с чужими программами.
  hotkeys: {
    play: '',
    next: '',
    previous: '',
    volumeUp: '',
    volumeDown: '',
    like: '',
    miniplayer: '',
    miniplayerUnlock: '',
    repeat: '',
    shuffle: '',
  },

  // Масштаб интерфейса в процентах.
  zoom: 100,

  // Не гасить экран, пока играет музыка.
  preventSleep: false,

  // Показывать процент при изменении громкости.
  showVolumePercent: true,

  // Дописывать время в строку исполнителя: в карточке голосового канала
  // Discord своего времени не показывает.
  timeInState: true,

  // Проверять, не вышла ли сборка мода под свежий клиент.
  updateCheck: true,

  // Не давать клиенту обновляться самому: иначе новый клиент сотрёт мод.
  // Обновление клиента вместе с модом мод предлагает сам.
  holdClientUpdates: true,

  // Подробный журнал: что уходит в Discord и что он отвечает.
  // Нужен только при разборе неполадок, поэтому выключен.
  debug: false,
};

let values = { ...DEFAULTS };
let filePath = null;
const listeners = new Set();

function load() {
  filePath = path.join(app.getPath('userData'), FILE);

  try {
    if (fs.existsSync(filePath)) {
      values = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    }
  } catch (e) {
    log.warn('Настройки повреждены, беру значения по умолчанию:', e.message);
    values = { ...DEFAULTS };
  }

  // Раньше клавиши были одним переключателем, а сочетание мини-плеера
  // лежало отдельно. Переносим старые настройки в новый вид.
  let migrated = false;

  if (typeof values.hotkeys === 'boolean') {
    const enabled = values.hotkeys;
    values.hotkeys = { ...DEFAULTS.hotkeys };

    if (!enabled) {
      for (const action of Object.keys(values.hotkeys)) values.hotkeys[action] = '';
    }

    migrated = true;
  }

  if (values.miniplayerHotkey) {
    values.hotkeys = { ...values.hotkeys, miniplayer: values.miniplayerHotkey };
    migrated = true;
  }

  // Раньше светлый вид был отдельным выключателем — стал одним из
  // вариантов подложки.
  if (typeof values.streamLight === 'boolean') {
    values.streamBackground = values.streamLight ? 'light' : 'dark';
    migrated = true;
  }

  delete values.streamLight;
  delete values.miniplayerHotkey;
  delete values.useLibrary;
  delete values.bisect;

  // Диагностический набор от 10.09 гасил название трека в списке
  // участников и подменял полосу счётчиком. Возвращаем как было —
  // один раз, по собственной отметке: сама отметка набора к этому
  // времени из части настроек уже удалена.
  if (!values.presetUndone) {
    values.progress = DEFAULTS.progress;
    values.showTrackInMemberList = DEFAULTS.showTrackInMemberList;
    values.presetUndone = true;
    migrated = true;
  }

  delete values.preset;
  delete values.authorStyle;

  // Неизвестные действия могли появиться в новой версии мода.
  values.hotkeys = { ...DEFAULTS.hotkeys, ...values.hotkeys };

  if (migrated) {
    save();
    log.info('Настройки перенесены в новый вид');
  }

  return values;
}

function save() {
  try {
    fs.writeFileSync(filePath, JSON.stringify(values, null, 2), 'utf8');
  } catch (e) {
    log.warn('Не удалось сохранить настройки:', e.message);
  }
}

const get = () => values;

function set(patch) {
  const before = { ...values };
  values = { ...values, ...patch };
  save();

  for (const listener of listeners) {
    try {
      listener(values, before);
    } catch (e) {
      log.warn('Ошибка обработчика настроек:', e.message);
    }
  }

  return values;
}

const onChange = (listener) => listeners.add(listener);

/** Канал для окна настроек в интерфейсе клиента. */
function start() {
  load();

  ipcMain.handle('kotamusic:settings:get', () => {
    // Занятые сочетания показываем в настройках: иначе человек решит,
    // что клавиша не работает по вине мода.
    let busy = [];
    try {
      busy = require('./hotkeys').busy();
    } catch {}

    return {
      values,
      defaults: DEFAULTS,
      version: branding.version,
      name: branding.name,
      links: branding.links,
      busy,
    };
  });

  // Часть настроек нужна окну до первой отрисовки: асинхронный ответ
  // опаздывает, и клиент успевает нарисовать по-своему.
  ipcMain.on('kotamusic:settings:sync', (event) => {
    event.returnValue = values;
  });

  // Окно должно узнавать об изменениях, а не перечитывать по случаю.
  onChange((now) => {
    const { BrowserWindow } = require('electron');

    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send('kotamusic:settings:changed', now);
    }
  });

  // Скопировать строку в буфер: адрес плашки для OBS проще отдать
  // кнопкой, чем просить переписать его руками.
  ipcMain.on('kotamusic:copy', (_event, text) => {
    try {
      require('electron').clipboard.writeText(String(text || ''));
      log.info('Скопировано:', text);
    } catch (e) {
      log.warn('Скопировать не вышло:', e.message);
    }
  });

  ipcMain.handle('kotamusic:settings:set', (_event, patch) => {
    if (!patch || typeof patch !== 'object') return values;

    // Принимаем только известные ключи — мало ли что придёт из окна.
    const clean = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in patch) clean[key] = patch[key];
    }

    log.info('Настройки изменены:', JSON.stringify(clean));
    return set(clean);
  });
}

module.exports = { start, get, set, onChange, DEFAULTS };
