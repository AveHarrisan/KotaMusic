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
  discordApplicationId: branding.discord.applicationId,

  // Мини-плеер поверх других окон.
  miniplayer: false,

  // Что показывать в мини-плеере.
  miniplayerSeek: true,
  miniplayerVolume: true,
  miniplayerClose: true,

  // Компактный вид: то же окно, но ниже и плотнее.
  miniplayerCompact: false,

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

  // Плашка «сейчас играет» на локальном адресе — для OBS.
  stream: false,
  streamPort: 8462,

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

  delete values.miniplayerHotkey;
  delete values.useLibrary;
  // Папку кеша клиент задаёт себе сам — настройка ничего не меняла.
  delete values.cacheDir;
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
