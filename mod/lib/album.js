'use strict';
// Названия альбомов. В панели плеера их нет — только номер альбома
// в ссылке на трек, поэтому берём название из открытого API Яндекса
// и запоминаем: за время сеанса один альбом спрашиваем один раз.

const log = require('./log');

const API = 'https://api.music.yandex.net/albums/';
const TIMEOUT_MS = 5000;
const CACHE_LIMIT = 200;

const cache = new Map();

/**
 * Номер альбома из ссылки. Внутри клиента она записана параметрами
 * (/album?albumId=123), а наружу мод отдаёт обычный адрес сайта
 * (/album/123/track/456) — понимаем оба вида.
 */
function albumIdFrom(url) {
  if (!url) return null;

  const found = /[?&]albumId=(\d+)/.exec(url) || /\/album\/(\d+)/.exec(url);
  return found ? found[1] : null;
}

async function titleFor(url) {
  const id = albumIdFrom(url);
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);

  try {
    const response = await fetch(API + id, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json();
    const title = body?.result?.title || null;

    // Неудачу тоже запоминаем — иначе будем долбить API на каждый трек.
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(id, title);

    return title;
  } catch (e) {
    cache.set(id, null);
    log.warn('Не удалось узнать альбом:', e.message);
    return null;
  }
}

module.exports = { titleFor, albumIdFrom };
