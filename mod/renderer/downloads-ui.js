'use strict';
// Скачивание в файл: кнопка в панели плеера, пункты в меню альбома,
// плейлиста и трека, полоска хода дела и подпись с качеством.
//
// Всё держится на метках `data-test-id` — это метки автотестов клиента,
// они переживают обновления лучше классов и разметки.

const { ipcRenderer } = require('electron');

const BAR = '[data-test-id="PLAYERBAR_DESKTOP"],[data-test-id="VIBE_PLAYERBAR"]';
const QUALITY_BUTTON = '[data-test-id="SOUND_QUALITY_BUTTON"]';

// Меню у клиента размечены одинаково: имя заканчивается на CONTEXT_MENU,
// а начало говорит, о чём оно — о треке, альбоме или плейлисте.
function menuKind(id) {
  if (id.startsWith('ALBUM')) return 'album';
  if (id.startsWith('PLAYLIST')) return 'playlist';
  return 'track';
}

const MARK = 'data-kotamusic-download';

const ICON_PATH = 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14';
const LYRICS_PATH = 'M5 6h14M5 11h9M5 16h11M5 21h7';
const FOLDER_PATH = 'M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z';

/** Стрелка вниз. Рисунок строим узлами: разметкой он бы не появился. */
function iconNode(size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATH);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  svg.appendChild(path);
  return svg;
}

let settings = {};
let lastTarget = null;

/** Разбирает ссылку клиента: /album/track?albumId=..&trackId=.. */
function idsFrom(href) {
  if (!href) return {};

  try {
    const url = new URL(href, 'https://music.yandex.ru/');
    const get = (name) => url.searchParams.get(name);

    // Ссылки бывают и обычными (/album/123/track/456), и с параметрами.
    const plain = /\/album\/(\d+)(?:\/track\/(\d+))?/.exec(url.pathname);
    const list = /\/users\/([^/]+)\/playlists\/(\d+)/.exec(url.pathname);

    return {
      albumId: get('albumId') || plain?.[1] || null,
      trackId: get('trackId') || plain?.[2] || null,
      owner: get('owner') || list?.[1] || null,
      kind: get('kind') || list?.[2] || null,
    };
  } catch {
    return {};
  }
}

/** Что играет сейчас: номер трека из ссылки в панели. */
function currentTrackId() {
  const bar = document.querySelector(BAR);
  if (!bar) return null;

  const link = bar.querySelector('a[href*="trackId="],a[href*="/track/"]');
  return idsFrom(link?.getAttribute('href')).trackId;
}

/** Бегущая строка дублирует текст — берём самый короткий повтор. */
function clean(node) {
  const value = (node?.textContent || '').trim();
  if (!value) return '';

  for (let size = 1; size <= value.length / 2; size += 1) {
    if (value.length % size) continue;
    const piece = value.slice(0, size);
    if (piece.repeat(value.length / size) === value) return piece;
  }

  return value;
}

/**
 * Что играет: номер, а если его нет — название с исполнителем.
 * В «Моей волне» ссылки на трек в панели не бывает вовсе.
 */
function currentTrack() {
  const bar = document.querySelector(BAR);
  if (!bar) return null;

  const title = clean(bar.querySelector('[data-test-id="TRACK_TITLE"],[data-test-id="VIBE_PLAYERBAR_TRACK_NAME"]'));
  const artists = [...bar.querySelectorAll('[data-test-id="SEPARATED_ARTIST_TITLE"]')].map(clean);
  const album = bar.querySelector('a[href*="albumId="],a[href*="/album/"]');

  return {
    trackId: currentTrackId(),
    title,
    artist: artists.filter(Boolean).join(', '),
    albumId: idsFrom(album?.getAttribute('href')).albumId,
  };
}

/** Скачать то, что играет: по номеру, а если его нет — по названию. */
async function downloadCurrent() {
  const about = currentTrack();
  if (!about?.trackId && !about?.title) return toast('Не понял, какой трек играет');

  toast('Скачиваю…', { progress: 0 });

  const result = about.trackId
    ? await ipcRenderer.invoke('kotamusic:download:track', about.trackId)
    : await ipcRenderer.invoke('kotamusic:download:current', about);

  if (!result?.ok) toast(`Не вышло: ${result?.error || 'неизвестная ошибка'}`);
}

/** Что лежит под последним нажатием: альбом, плейлист или трек. */
function targetIds() {
  let node = lastTarget;

  for (let depth = 0; node && depth < 12; depth += 1) {
    const link = node.matches?.('a[href]')
      ? node
      : node.querySelector?.('a[href*="albumId="],a[href*="/album/"],a[href*="/playlists/"]');

    const ids = idsFrom(link?.getAttribute('href'));
    if (ids.albumId || ids.owner) return ids;

    node = node.parentElement;
  }

  return idsFrom(location.pathname + location.search);
}

/** Короткое сообщение в углу — своё, чтобы не спорить с клиентом. */
function toast(text, { progress = null, id = 'kotamusic-toast' } = {}) {
  let box = document.querySelector(`[data-kotamusic-progress="${id}"]`);

  if (!box) {
    box = document.createElement('div');
    box.setAttribute('data-kotamusic-progress', id);
    box.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);bottom:92px;z-index:2147483646;' +
      'min-width:260px;max-width:min(520px,90vw);padding:10px 14px;border-radius:12px;' +
      'background:#2a2a2a;color:#fff;font:13px/1.35 system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.45);-webkit-app-region:no-drag';

    const label = document.createElement('div');
    label.setAttribute('data-role', 'label');
    box.appendChild(label);

    const track = document.createElement('div');
    track.setAttribute('data-role', 'track');
    track.style.cssText =
      'margin-top:8px;height:4px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden';

    const fill = document.createElement('div');
    fill.setAttribute('data-role', 'fill');
    fill.style.cssText = 'height:100%;width:0;background:#ffdb4d;transition:width .2s';

    track.appendChild(fill);
    box.appendChild(track);
    document.body.appendChild(box);
  }

  box.querySelector('[data-role="label"]').textContent = text;

  const track = box.querySelector('[data-role="track"]');
  const fill = box.querySelector('[data-role="fill"]');

  track.style.display = progress === null ? 'none' : '';
  if (progress !== null) fill.style.width = `${Math.round(progress * 100)}%`;

  clearTimeout(box.dataset.timer);
  if (progress === null) {
    box.dataset.timer = setTimeout(() => box.remove(), 4000);
  }

  return box;
}

/** Кнопка в панели плеера — рядом с выбором качества. */
function buildButton() {
  const bar = document.querySelector(BAR);
  if (!bar) return;

  const anchor = document.querySelector(QUALITY_BUTTON);
  if (!anchor || !anchor.parentElement) return;

  const shown = document.querySelector(`[${MARK}]`);
  if (shown && shown.parentElement === anchor.parentElement) return;
  shown?.remove();

  // Берём соседнюю кнопку целиком: так наша совпадёт по размеру,
  // отступам и поведению при наведении, чем бы их клиент ни задавал.
  const button = anchor.cloneNode(true);
  button.setAttribute(MARK, '1');
  button.removeAttribute('data-test-id');
  button.removeAttribute('aria-haspopup');
  button.removeAttribute('aria-expanded');
  button.title = 'Скачать трек в файл';
  button.setAttribute('aria-label', 'Скачать трек в файл');
  button.replaceChildren(iconNode());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloadCurrent();
  });

  anchor.parentElement.insertBefore(button, anchor);
}

/** Пункт «Скачать в файл» в открывшемся меню. */
/** Меняет подпись пункта, не трогая значок рядом с ней. */
function setLabel(item, text) {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let found = null;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.trim()) found = walker.currentNode;
  }

  if (found) found.nodeValue = text;
  else item.append(text);
}

/** Подменяет рисунок значка своим. */
function setIcon(item, shape) {
  const picture = item.querySelector('svg');
  if (!picture) return;

  picture.setAttribute('viewBox', '0 0 24 24');
  picture.setAttribute('fill', 'none');
  picture.replaceChildren();

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', shape);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  picture.appendChild(path);
}

function addMenuItem({ node, items }, kind) {
  if (node.querySelector(`[${MARK}-item]`)) return;

  // Клонируем настоящий пункт меню: так наш получает и значок, и отступы,
  // и подсветку при наведении, чем бы их клиент ни задавал. Если в меню
  // есть «Скачать» — берём его: значок со стрелкой там уже нужный.
  const sample = items.find((node) => /^Скачать/i.test(node.textContent.trim())) || items[0];
  if (!sample?.parentElement) return;

  const item = sample.cloneNode(true);
  item.setAttribute(`${MARK}-item`, '1');
  item.removeAttribute('data-test-id');

  // Если за образец взяли не «Скачать», значок у клона чужой — рисуем свой.
  if (!/^Скачать/i.test(sample.textContent.trim())) setIcon(item, ICON_PATH);

  setLabel(item, 'Скачать в файл');

  item.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const ids = kind === 'track' ? { trackId: currentMenuTrackId() } : targetIds();

    if (kind === 'album' && ids.albumId) {
      toast('Скачиваю альбом…', { progress: 0 });
      const result = await ipcRenderer.invoke('kotamusic:download:album', ids.albumId);
      if (!result?.ok) toast(`Не вышло: ${result?.error || 'ошибка'}`);
    } else if (kind === 'playlist' && ids.owner && ids.kind) {
      toast('Скачиваю плейлист…', { progress: 0 });
      const result = await ipcRenderer.invoke('kotamusic:download:playlist', ids.owner, ids.kind);
      if (!result?.ok) toast(`Не вышло: ${result?.error || 'ошибка'}`);
    } else if (ids.trackId) {
      toast('Скачиваю…', { progress: 0 });
      const result = await ipcRenderer.invoke('kotamusic:download:track', ids.trackId);
      if (!result?.ok) toast(`Не вышло: ${result?.error || 'ошибка'}`);
    } else {
      // Меню «Моей волны» ссылок не содержит — качаем то, что играет.
      await downloadCurrent();
    }

    document.body.click(); // меню закрывается само, как после своих пунктов
  });

  // Ставим последним пунктом, после всех настоящих.
  items[items.length - 1].insertAdjacentElement('afterend', item);

  // Над скачиванием — текст песни: в «Моей волне» кнопки текста нет,
  // а посмотреть слова хочется и там.
  if (settings.lyricsButton !== false) {
    const words = item.cloneNode(true);
    words.setAttribute(`${MARK}-item`, '1');
    setLabel(words, 'Текст песни');
    setIcon(words, LYRICS_PATH);

    words.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('kotamusic:lyrics:toggle'));
      document.body.click();
    });

    item.insertAdjacentElement('beforebegin', words);
  }

  // Следом — «Открыть папку»: сразу после скачивания это первое,
  // что хочется сделать.
  const open = item.cloneNode(true);
  open.setAttribute(`${MARK}-item`, '1');
  setLabel(open, 'Открыть папку со скачанным');
  setIcon(open, FOLDER_PATH);

  open.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.invoke('kotamusic:download:folder');
    document.body.click();
  });

  item.insertAdjacentElement('afterend', open);

}

/** Номер трека, по которому открыли меню. */
function currentMenuTrackId() {
  const ids = targetIds();
  return ids.trackId || currentTrackId();
}

/**
 * Само меню метки не имеет, поэтому находим его по виду: отдельный слой
 * поверх страницы, внутри которого несколько строк с подписями.
 */
function openMenu() {
  const bar = document.querySelector(BAR);

  for (const node of document.querySelectorAll('div,ul,section,nav')) {
    if (bar?.contains(node) || node.hasAttribute(`${MARK}-item`)) continue;

    // Окна вроде «Настроек звука» — не меню: туда наши пункты не нужны.
    if (node.closest('[role="dialog"],[aria-modal="true"]')) continue;

    const rect = node.getBoundingClientRect();
    if (rect.width < 140 || rect.width > 380 || rect.height < 100) continue;

    const items = [...node.children].filter((child) => {
      const size = child.getBoundingClientRect();
      if (!child.textContent.trim() || size.height < 24 || size.height > 52) return false;

      // У пунктов меню всегда есть значок и короткая подпись в одну строку.
      return Boolean(child.querySelector('svg')) && child.textContent.trim().length < 40;
    });

    if (items.length < 4) continue;

    // Меню лежит поверх страницы: в его середине нет ничего чужого.
    const top = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + rect.height / 2)
    );

    if (top && node.contains(top)) return { node, items };
  }

  return null;
}


function watchMenus() {
  const menu = openMenu();
  if (!menu) return;


  const opener = lastTarget?.closest?.('[data-test-id$="CONTEXT_MENU_BUTTON"]');
  addMenuItem(menu, menuKind(opener?.getAttribute('data-test-id') || ''));
}

function start() {
  document.addEventListener('pointerdown', (event) => (lastTarget = event.target), true);

  document.addEventListener('contextmenu', (event) => (lastTarget = event.target), true);

  ipcRenderer.on('kotamusic:download:progress', (_event, state) => {
    if (!state) return;

    if (state.error) return toast(`Не вышло: ${state.error}`);

    if (state.done) {
      toast(state.folder ? `Готово: ${state.folder}` : `Скачано: ${state.title}`);
      return;
    }

    const parts = [state.title, state.text, state.speed].filter(Boolean);
    toast(`Скачиваю: ${parts.join(' · ')}`, { progress: state.share || 0 });
  });

  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    settings = state?.values || {};

    const tick = () => {
      if (settings.downloadButton !== false) buildButton();
      watchMenus();
    };

    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
    setInterval(tick, 1000);
    tick();
  });

  ipcRenderer.on('kotamusic:settings:changed', (_event, values) => {
    settings = values || settings;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
