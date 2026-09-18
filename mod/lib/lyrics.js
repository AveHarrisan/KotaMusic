'use strict';
// Текст песни: сначала спрашиваем Яндекс, а если у него текста нет —
// открытую базу LRCLib. Там же находятся тексты для треков, которых в
// Яндексе нет вовсе: например, для своих загрузок.

const { ipcMain } = require('electron');

const api = require('./tracks-api');
const settings = require('./settings');
const branding = require('../branding');
const log = require('./log');

const LRCLIB = 'https://lrclib.net/api';

// Ответы храним в памяти: за время работы клиента текст не меняется.
const cache = new Map();
const CACHE_LIMIT = 200;

/** Разбор LRC: строки со временем «[01:23.45] текст». */
function parseLrc(text) {
  const lines = [];

  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;

    const words = raw.replace(/\[[^\]]*\]/g, '').trim();

    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = Number((stamp[3] || '0').padEnd(3, '0')) / 1000;

      lines.push({ time: minutes * 60 + seconds + fraction, text: words });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Иногда вместо текста приходит заглушка из точек или тире — это значит
 * «текста нет», и надо идти дальше.
 */
function isEmptyText(text) {
  const clean = String(text || '')
    .replace(/[\s.\-–—_•]/g, '')
    .trim();

  return clean.length < 3;
}

async function fromYandex(trackId) {
  try {
    const text = await api.lyrics(trackId);
    if (!text || isEmptyText(text)) return null;

    const lines = parseLrc(text);
    return { source: 'Яндекс Музыка', synced: lines.length > 0, lines, text };
  } catch (e) {
    log.debug('Текста у Яндекса нет:', e.message);
    return null;
  }
}

async function ask(path, params) {
  const url = `${LRCLIB}/${path}?${new URLSearchParams(params)}`;
  const response = await fetch(url, {
    headers: { 'user-agent': `${branding.name} ${branding.version} (${branding.repositoryUrl})` },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LRCLib: HTTP ${response.status}`);

  return await response.json();
}

/** Ответ LRCLib → наш вид. */
function fromLrclibItem(item) {
  if (!item || item.instrumental) return null;

  if (item.syncedLyrics && !isEmptyText(item.syncedLyrics)) {
    return {
      source: 'LRCLib',
      synced: true,
      lines: parseLrc(item.syncedLyrics),
      text: item.syncedLyrics,
    };
  }

  if (item.plainLyrics && !isEmptyText(item.plainLyrics)) {
    return { source: 'LRCLib', synced: false, lines: [], text: item.plainLyrics };
  }

  return null;
}

async function fromLrclib({ title, artist, album, duration }) {
  if (!title || !artist) return null;

  try {
    // Сначала точный поиск: он учитывает длительность и почти не ошибается.
    const exact = await ask('get', {
      track_name: title,
      artist_name: artist,
      ...(album ? { album_name: album } : {}),
      ...(duration ? { duration: Math.round(duration) } : {}),
    });

    const found = fromLrclibItem(exact);
    if (found) return found;

    // Не нашлось — обычный поиск, из ответа берём подходящее по времени.
    const list = await ask('search', { track_name: title, artist_name: artist });
    if (!Array.isArray(list) || !list.length) return null;

    const suitable = list
      .filter((item) => !duration || Math.abs((item.duration || 0) - duration) <= 10)
      .sort(
        (a, b) =>
          Math.abs((a.duration || 0) - (duration || 0)) - Math.abs((b.duration || 0) - (duration || 0))
      );

    for (const item of suitable.length ? suitable : list) {
      const result = fromLrclibItem(item);
      if (result) return result;
    }

    return null;
  } catch (e) {
    log.debug('LRCLib не ответил:', e.message);
    return null;
  }
}

/** Текст для трека: Яндекс, а следом LRCLib. */
async function lyricsFor({ trackId, title, artist, album, duration }) {
  const key = trackId || `${artist} — ${title}`;
  if (cache.has(key)) return cache.get(key);

  let result = trackId ? await fromYandex(trackId) : null;

  if (!result && settings.get().lyricsLrclib !== false) {
    result = await fromLrclib({ title, artist, album, duration });
  }

  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(key, result);

  if (result) log.debug(`Текст найден (${result.source}), строк: ${result.lines.length}`);
  return result;
}

function start() {
  ipcMain.handle('kotamusic:lyrics:get', (_event, track) => lyricsFor(track || {}));

  // Проверка панели без мыши: окно само откроет её и будет писать в
  // журнал, какая строка подсвечена. Включается переменной окружения.
  if (process.env.KOTAMUSIC_LYRICS_TEST) {
    setTimeout(() => {
      for (const window of require('electron').BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('kotamusic:lyrics:open');
      }
    }, 9000);
  }
}

module.exports = { start, lyricsFor, parseLrc, isEmptyText };
