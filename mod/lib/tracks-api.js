'use strict';
// Работа с открытым API Яндекс Музыки для скачивания треков.
//
// Клиент сам ходит в этот же API, мы лишь просим у него то же самое от
// имени того же человека: токен берём из клиента, ничего не обходим —
// без подписки Плюс сервер просто не отдаст ссылку.

const crypto = require('crypto');
const { BrowserWindow } = require('electron');

const branding = require('../branding');
const log = require('./log');

const BASE = 'https://api.music.yandex.net/';

// Секрет подписи запросов за ссылкой на файл — тот же, что у клиента.
const SIGN_SECRET = 'kzqU4XhfCaY6B6JTHODeq5';

// Порядок важен: сервер отдаёт лучший из перечисленных.
const CODECS = ['flac', 'aac', 'he-aac', 'mp3', 'flac-mp4', 'aac-mp4', 'he-aac-mp4'];
// raw — файл отдаётся как есть; encraw был бы зашифрован, и ключ
// пришлось бы применять самим без всякой пользы.
const TRANSPORTS = ['raw'];

// Запросов за раз: столько же берёт сам клиент.
const BATCH = 50;

let token = null;

/** Подпись запроса: HMAC-SHA256 в base64. */
function sign(message, cutLast = true) {
  const mac = crypto.createHmac('sha256', SIGN_SECRET).update(message).digest('base64');
  return cutLast ? mac.slice(0, -1) : mac;
}

/** Окно клиента: из него берём токен и строку браузера. */
function clientWindow() {
  return BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.getTitle?.() !== branding.name
  );
}

/**
 * Токен человека лежит в хранилище страницы клиента. Своего у мода нет
 * и быть не должно: мы работаем от имени того, кто уже вошёл.
 */
async function getToken() {
  if (token) return token;

  const window = clientWindow();
  if (!window) throw new Error('Окно клиента ещё не открыто');

  const value = await window.webContents.executeJavaScript(
    'try { JSON.parse(localStorage.getItem("oauth")).value } catch (e) { null }'
  );

  if (!value) throw new Error('Не нашёл токен: войдите в аккаунт');

  token = value;
  return token;
}

/** Забыть токен: после выхода из аккаунта он больше не годится. */
function forgetToken() {
  token = null;
}

async function headers() {
  const window = clientWindow();

  return {
    authorization: `OAuth ${await getToken()}`,
    'x-yandex-music-client': `YandexMusicDesktopAppWindows/${branding.builtForClient}`,
    'accept-language': 'ru',
    'x-yandex-music-without-invocation-info': '1',
    'user-agent': window?.webContents.getUserAgent() || branding.name,
  };
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(BASE + path, { method, body, headers: await headers() });

  if (response.status === 401) {
    forgetToken();
    throw new Error('Яндекс не принял токен, попробуйте ещё раз');
  }

  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);

  const data = await response.json();
  return data.result ?? data;
}

/** Сведения о треках: название, исполнители, альбом, обложка. */
async function tracksMeta(ids) {
  const out = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const form = new URLSearchParams({
      trackIds: chunk.join(','),
      removeDuplicates: 'false',
      withProgress: 'false',
    });

    const part = await request('tracks', { method: 'POST', body: form });
    out.push(...(Array.isArray(part) ? part : []));
  }

  return out;
}

const ts = () => Math.floor(Date.now() / 1000);

/** Ссылка на файл одного трека. */
async function fileInfo(trackId, { mp3 = false, quality: wanted = null } = {}) {
  const codecs = mp3 ? ['mp3'] : CODECS;
  const stamp = ts();

  // Качество: либо выбранное человеком в клиенте, либо лучшее из
  // доступного — для скачивания нам нужно именно оно. В клиенте выбор
  // называется своими словами, у API — своими.
  const named = { high_quality: 'lossless', balanced: 'nq', efficient: 'lq', preview: 'lq' };
  const known = ['lossless', 'hq', 'nq', 'lq'];
  const asked = named[wanted] || (known.includes(wanted) ? wanted : null);
  const quality = mp3 ? 'nq' : asked || 'lossless';

  const params = new URLSearchParams({
    trackId: String(trackId),
    ts: String(stamp),
    quality,
    codecs: codecs.join(','),
    transports: TRANSPORTS.join(','),
    sign: sign(`${stamp}${trackId}${quality}${codecs.join('')}${TRANSPORTS.join('')}`),
  });

  const data = await request(`get-file-info?${params}`);
  return data.downloadInfo;
}

/** Ссылки на файлы пачкой — так же, как это делает клиент. */
async function fileInfoBatch(ids, { mp3 = false } = {}) {
  const codecs = mp3 ? ['mp3'] : CODECS;
  const quality = mp3 ? 'nq' : 'lossless';
  const out = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH).map(String);
    const stamp = ts();

    const params = new URLSearchParams({
      trackIds: chunk.join(','),
      ts: String(stamp),
      quality,
      codecs: codecs.join(','),
      transports: TRANSPORTS.join(','),
      sign: sign(`${stamp}${chunk.join(',')}${quality}${codecs.join('')}${TRANSPORTS.join('')}`),
    });

    const data = await request(`get-file-info/batch?${params}`);
    out.push(...(data.downloadInfos || []));
  }

  return out;
}

/** Синхронный текст трека в формате LRC, если он есть у Яндекса. */
async function lyrics(trackId) {
  const stamp = ts();

  const params = new URLSearchParams({
    timeStamp: String(stamp),
    format: 'LRC',
    sign: sign(`${trackId}${stamp}`, false),
  });

  const info = await request(`tracks/${trackId}/lyrics?${params}`);
  if (!info?.downloadUrl) return null;

  const response = await fetch(info.downloadUrl);
  if (!response.ok) throw new Error(`Текст: HTTP ${response.status}`);

  return await response.text();
}

/** Обложка трека или альбома нужного размера. */
async function cover(uri, size = 400) {
  if (!uri) return null;

  const response = await fetch(`https://${uri.replace('%%', `${size}x${size}`)}`);
  if (!response.ok) {
    log.debug('Обложку скачать не вышло:', response.status);
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

/** Поиск трека по названию и исполнителю. */
async function findTrack({ title, artist, albumId }) {
  // Если известен альбом — ищем среди его треков: это точнее поиска.
  if (albumId) {
    try {
      const { tracks } = await albumTracks(albumId);
      const same = tracks.find(
        (track) => String(track.title || '').toLowerCase() === String(title || '').toLowerCase()
      );
      if (same) return same;
    } catch (e) {
      log.debug('Альбом не прочитался:', e.message);
    }
  }

  if (!title) return null;

  const params = new URLSearchParams({
    type: 'track',
    page: '0',
    nocorrect: 'false',
    text: [artist, title].filter(Boolean).join(' '),
  });

  const found = await request(`search?${params}`);
  const results = found?.tracks?.results || [];

  const wanted = String(title).toLowerCase();
  return (
    results.find((track) => String(track.title || '').toLowerCase() === wanted) || results[0] || null
  );
}

/** Треки альбома по порядку. */
async function albumTracks(albumId) {
  const album = await request(`albums/${albumId}/with-tracks`);
  const volumes = album?.volumes || [];
  return {
    title: album?.title || '',
    tracks: volumes.flat().filter(Boolean),
  };
}

/**
 * Популярные треки исполнителя: то же, что клиент показывает в его шапке.
 * Скачивать «всё подряд» у исполнителя незачем — берём ходовые.
 */
async function artistTracks(artistId, limit = 20) {
  const brief = await request(`artists/${artistId}/brief-info`);
  const ready = (brief?.popularTracks || []).filter((track) => track?.id);

  const name = brief?.artist?.name || 'Исполнитель';
  if (ready.length) return { title: name, tracks: ready.slice(0, limit) };

  // Бывает, что приходят одни номера.
  const list = await request(`artists/${artistId}/track-ids-by-rating`);
  const ids = (list?.tracks || []).slice(0, limit).map(String);
  const tracks = ids.length ? await tracksMeta(ids) : [];
  return { title: name, tracks };
}

/** Треки плейлиста. */
let uid = null;

/** Свой номер в Яндексе: по логину часть запросов даёт отказ. */
async function myUid() {
  if (uid) return uid;

  const status = await request('account/status');
  uid = status?.account?.uid ? String(status.account.uid) : null;
  return uid;
}

/** Плейлисты человека: номер и название. */
async function playlists(owner) {
  const who = /^\d+$/.test(String(owner)) ? owner : (await myUid()) || owner;
  const list = await request(`users/${who}/playlists/list`);
  return (list || []).map((item) => ({ kind: item.kind, title: item.title, tracks: item.trackCount }));
}

async function playlistTracks(owner, kind) {
  // По логину часть запросов Яндекс отклоняет, поэтому берём номер.
  const who = /^\d+$/.test(String(owner)) ? owner : (await myUid()) || owner;
  const playlist = await request(`users/${who}/playlists/${kind}`);
  const items = playlist?.tracks || [];

  const ready = items.map((item) => item.track).filter(Boolean);
  if (ready.length) return { title: playlist?.title || '', tracks: ready };

  // Бывает, что список приходит одними номерами.
  let ids = items.map((item) => item.id || item.trackId).filter(Boolean);

  // А «Мне нравится» — вообще не обычный плейлист: его треки лежат
  // отдельно, среди отметок «нравится».
  if (!ids.length) {
    const likes = await request(`users/${who}/likes/tracks`);
    ids = (likes?.library?.tracks || likes?.tracks || [])
      .map((item) => item.id || item.trackId || item)
      .filter(Boolean);
  }

  const tracks = ids.length ? await tracksMeta(ids.map(String)) : [];
  return { title: playlist?.title || 'Плейлист', tracks };
}

/**
 * Плейлист по опознавателю из клиента: с 5.120 страницы плейлистов
 * открываются по `playlistUuid`, а не по паре «владелец и номер».
 */
async function playlistByUuid(uuid) {
  const playlist = await request(`playlist/${uuid}`);
  const items = playlist?.tracks || [];

  const ready = items.map((item) => item.track || item).filter((item) => item?.id && item?.title);
  if (ready.length) return { title: playlist?.title || 'Плейлист', tracks: ready };

  const ids = items.map((item) => item.id || item.trackId).filter(Boolean);
  const tracks = ids.length ? await tracksMeta(ids.map(String)) : [];
  return { title: playlist?.title || 'Плейлист', tracks };
}

// Метки качества и кодека — такие же, какими их называет сам клиент.
const QUALITY_LABEL = { lq: 'LQ', nq: 'NQ', hq: 'HQ', lossless: 'HQ+' };
const CODEC_LABEL = {
  mp3: 'MP3',
  aac: 'AAC',
  'aac-mp4': 'AAC',
  'he-aac': 'HE-AAC',
  'he-aac-mp4': 'HE-AAC',
  flac: 'FLAC',
  'flac-mp4': 'FLAC',
};

module.exports = {
  QUALITY_LABEL,
  CODEC_LABEL,
  sign,
  getToken,
  forgetToken,
  tracksMeta,
  findTrack,
  playlists,
  myUid,
  fileInfo,
  fileInfoBatch,
  lyrics,
  cover,
  albumTracks,
  playlistTracks,
  playlistByUuid,
  artistTracks,
};
