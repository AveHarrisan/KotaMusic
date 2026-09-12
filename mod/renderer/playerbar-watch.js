'use strict';
// Читает состояние плеера из панели и отправляет в главный процесс.
//
// Почему из интерфейса: штатный канал desktop:player:state передаёт только
// флаги «играет / можно вперёд / можно назад» и жёстко отбрасывает лишние
// поля — данных о треке в главном процессе нет вовсе. Внутреннее состояние
// плеера спрятано в минифицированном коде, а метки панели (data-test-id)
// стабильны, ими же пользуются автотесты клиента.

const { ipcRenderer } = require('electron');

const CHANNEL = 'kotamusic:player:track';
const WEB_BASE = 'https://music.yandex.ru';

// У клиента две панели плеера: обычная и «Моя волна». Метки у них разные,
// поэтому для каждого элемента держим список вариантов по порядку.
const ID = {
  bar: ['PLAYERBAR_DESKTOP', 'VIBE_PLAYERBAR'],
  title: ['TRACK_TITLE', 'VIBE_PLAYERBAR_TRACK_NAME'],
  artist: ['SEPARATED_ARTIST_TITLE'],
  cover: ['ENTITY_COVER_IMAGE', 'VIBE_ALBUM_COVER', 'PLAYERBAR_DESKTOP_COVER_CONTAINER'],
  pause: ['PAUSE_BUTTON'],
  slider: ['TIMECODE_SLIDER'],
  timecode: ['VIBE_PLAYERBAR_TIMECODE'],
};

const selector = (ids) => ids.map((id) => `[data-test-id="${id}"]`).join(',');

/** Первый подходящий элемент из списка вариантов. */
const pick = (root, ids) => (root ? root.querySelector(selector(ids)) : null);
const pickAll = (root, ids) => (root ? [...root.querySelectorAll(selector(ids))] : []);

const text = (el) => (el?.textContent || '').trim();

/**
 * Бегущая строка дублирует текст ради прокрутки — иногда дважды, иногда
 * трижды. Ищем самый короткий кусок, повторами которого набрана вся строка.
 */
function cleanText(el) {
  const value = text(el);
  if (!value) return value;

  for (let size = 1; size <= value.length / 2; size++) {
    if (value.length % size) continue;

    const piece = value.slice(0, size);
    if (piece.repeat(value.length / size) === value) return piece;
  }
  return value;
}

/** Ссылки в панели относительные — приводим к обычным адресам. */
function absolute(href) {
  if (!href) return null;

  // Внутри клиента ссылки записаны параметрами: /album?albumId=9553251.
  // На сайте такого адреса нет — открывается «Ничего не нашлось», и по
  // названию трека в Discord человек попадал в пустоту. Переводим их в
  // обычные адреса сайта.
  try {
    const url = new URL(href, `${WEB_BASE}/`);
    const id = (name) => url.searchParams.get(name);

    if (url.pathname === '/album' && id('albumId')) {
      const track = id('trackId');
      return `${WEB_BASE}/album/${id('albumId')}${track ? `/track/${track}` : ''}`;
    }

    if (url.pathname === '/artist' && id('artistId')) {
      return `${WEB_BASE}/artist/${id('artistId')}`;
    }

    if (url.pathname === '/playlist' && id('owner') && id('kind')) {
      return `${WEB_BASE}/users/${id('owner')}/playlists/${id('kind')}`;
    }

    return WEB_BASE + url.pathname + url.search;
  } catch {
    return href.startsWith('http') ? href : WEB_BASE + href;
  }
}

/** Текущая громкость от 0 до 1. */
function readVolume() {
  const slider = document.querySelector('[data-test-id="CHANGE_VOLUME_SLIDER"]');
  if (!slider) return null;

  const max = Number(slider.max) || 1;
  const value = Number(slider.value);
  return Number.isFinite(value) ? value / max : null;
}

/** Кнопка воспроизведения ближе всего к панели плеера. */
function nearestControl(bar) {
  const selector = '[data-test-id="PAUSE_BUTTON"],[data-test-id="PLAY_BUTTON"]';

  let node = bar;
  for (let depth = 0; node && depth < 8; depth++) {
    const found = node.querySelector(selector);
    if (found) return found;
    node = node.parentElement;
  }

  return null;
}

/** «00:08 / 02:50» → секунды. */
function parseTimecode(value) {
  const parts = String(value || '').split('/');
  if (parts.length !== 2) return null;

  const seconds = (part) => {
    const bits = part.trim().split(':').map(Number);
    if (bits.some((n) => !Number.isFinite(n))) return NaN;
    return bits.reduce((total, n) => total * 60 + n, 0);
  };

  const position = seconds(parts[0]);
  const duration = seconds(parts[1]);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return null;

  return { position, duration };
}

/** Адрес обложки: элемент бывает и картинкой, и контейнером с картинкой. */
function imageFrom(node) {
  if (!node) return null;

  const img = node.tagName === 'IMG' ? node : node.querySelector('img');
  const src = img?.currentSrc || img?.src;
  if (!src) return null;

  // Размер в адресе бывает «100x100» или «orig» — просим удобную середину.
  return src.replace(/\/(?:\d+x\d+|orig)$/, '/400x400');
}

function readState() {
  const bar = pick(document, ID.bar);
  if (!bar) return null;

  const titleEl = pick(bar, ID.title);
  const title = cleanText(titleEl);
  if (!title) return null;

  // В режиме «Моей волны» исполнители и кнопка паузы живут вне панели.
  // В «Моей волне» ни название, ни исполнитель не ссылки — там есть
  // только ссылка на альбом. Её и используем: по ней открывается трек
  // и по её номеру определяется название альбома.
  const albumLink = bar.querySelector('a[href*="albumId="]');

  const artistLinks = pickAll(bar, ID.artist).length
    ? pickAll(bar, ID.artist)
    : pickAll(document, ID.artist);

  // Обложку ищем только внутри панели: по всей странице попадётся
  // картинка первой попавшейся карточки, и она не будет меняться.
  const coverNode = pick(bar, ID.cover);
  const coverUrl = imageFrom(coverNode);
  const slider = pick(bar, ID.slider) || pick(document, ID.slider);
  // Состояние читаем по кнопке рядом с панелью: такие же кнопки есть
  // в карточках на странице, и по ним легко ошибиться.
  const control = nearestControl(bar);

  let position = slider ? Number(slider.value) : NaN;
  let duration = slider ? Number(slider.max) : NaN;

  // В «Моей волне» ползунка нет — время написано текстом «00:08 / 02:50».
  if (!Number.isFinite(duration) || duration <= 0) {
    const parsed = parseTimecode(text(pick(bar, ID.timecode) || pick(document, ID.timecode)));
    if (parsed) {
      position = parsed.position;
      duration = parsed.duration;
    }
  }

  return {
    title,
    artists: artistLinks.map(cleanText).filter(Boolean),
    trackUrl: absolute(titleEl?.getAttribute('href') || albumLink?.getAttribute('href')),
    artistUrl: absolute(artistLinks[0]?.getAttribute('href')),
    cover: coverUrl,
    // Кнопка «Пауза» стоит на месте «Воспроизвести», пока идёт музыка.
    isPlaying: control?.getAttribute('data-test-id') === 'PAUSE_BUTTON',
    control: control?.getAttribute('data-test-id') ?? null,
    volume: readVolume(),
    position: Number.isFinite(position) ? position : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

let dumped = false;

/** Если у трека нет ссылок, один раз отдаём разметку — по ней чиним чтение. */
function dumpOnce(bar) {
  if (dumped || !bar) return;
  dumped = true;
  ipcRenderer.send('kotamusic:debug:dom', bar.parentElement?.outerHTML?.slice(0, 60000) || '');
}

let last = '';
let candidate = null; // состояние, ожидающее подтверждения
let timer = null;

function push() {

  let state = null;
  try {
    state = readState();
  } catch {
    return;
  }

  // Позиция и громкость меняются часто — сами по себе они не повод
  // пересобирать статус, поэтому из сравнения их исключаем.
  const { position, volume, ...stable } = state || {};
  const snapshot = JSON.stringify(stable);
  if (snapshot === last) return;

  // На стыке треков панель на миг показывает склейку старого и нового —
  // например «nw2b, airness —back to life». Отправляем только то,
  // что подтвердилось повторным чтением.
  if (snapshot !== candidate) {
    candidate = snapshot;
    clearTimeout(timer);
    timer = setTimeout(push, 250);
    return;
  }

  // На стыке треков панель успевает показать склейку названия
  // с исполнителем и без исполнителей вовсе — такое не отправляем.
  if (state && !state.artists.length && state.title.includes('—')) return;

  if (state && !state.trackUrl) dumpOnce(pick(document, ID.bar));

  last = snapshot;
  ipcRenderer.send(CHANNEL, state);
}

/** Раз в секунду сообщаем позицию — чтобы отсчёт в Discord не отставал. */
function tick() {
  try {
    const state = readState();
    if (!state || !Number.isFinite(state.position)) return;

    ipcRenderer.send('kotamusic:player:tick', {
      title: state.title,
      position: state.position,
      duration: state.duration,
      volume: state.volume,
      isPlaying: state.isPlaying,
    });
  } catch {}
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(push, 120); // панель перерисовывается пачками
}

function start() {
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-test-id', 'value', 'src'],
  });

  setInterval(push, 3000); // подстраховка, если наблюдатель что-то пропустит
  setInterval(tick, 1000);
  push();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
