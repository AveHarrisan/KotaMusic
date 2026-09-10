'use strict';
// Настройки мода. Лежат рядом с данными клиента, чтобы переживать
// обновления: пересборка мода их не трогает.

const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const branding = require('../branding');
const log = require('./log');

const FILE = 'kotamusic.json';

// Состав статуса, который в проверке 10.09 доходил до других участников.
// От него отталкиваемся, возвращая остальные возможности по одной.
const WORKING_PRESET = {
  progress: 'counter',
  showTrackInMemberList: false,
  useLibrary: true,
};

const DEFAULTS = {
  // Отметка применённого набора: без неё сохранённые ранее значения
  // остались бы поверх и проверка была бы нечистой.
  preset: null,

  richPresence: true,
  // 'bar' — полоса с началом и концом (видна в карточке профиля)
  // 'counter' — счётчик времени (виден и в карточке голосового канала)
  progress: branding.discord.progress,
  showButtons: branding.discord.showButtons,
  showTrackInMemberList: branding.discord.modernFields,
  showAlbum: true,
  discordApplicationId: branding.discord.applicationId,

  // Чем отправлять статус: своим клиентом или библиотекой старого мода.
  // Переключатель нужен, пока выясняем, почему статус не рассылается.
  useLibrary: false,

  // Подробный журнал: что уходит в Discord и что он отвечает.
  debug: true,
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

  // Один раз приводим настройки к проверенному набору.
  if (values.preset !== 'working-2026-09-10') {
    values = { ...values, ...WORKING_PRESET, preset: 'working-2026-09-10' };
    save();
    log.info('Настройки приведены к проверенному набору');
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

  ipcMain.handle('kotamusic:settings:get', () => ({
    values,
    defaults: DEFAULTS,
    version: branding.version,
    name: branding.name,
  }));

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
