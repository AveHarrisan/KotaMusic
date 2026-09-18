'use strict';
// Своя панель с текстом песни.
//
// У клиента текст есть не для всякого трека, а для своих загрузок его нет
// вовсе. Мод берёт текст у Яндекса, а если там пусто — в открытой базе
// LRCLib, и показывает своей панелью, подсвечивая строку по времени.

const { ipcRenderer } = require('electron');

const BAR = '[data-test-id="PLAYERBAR_DESKTOP"],[data-test-id="VIBE_PLAYERBAR"]';
const QUALITY_BUTTON = '[data-test-id="SOUND_QUALITY_BUTTON"]';
const TITLE = '[data-test-id="TRACK_TITLE"],[data-test-id="VIBE_PLAYERBAR_TRACK_NAME"]';
const ARTIST = '[data-test-id="SEPARATED_ARTIST_TITLE"]';
const SLIDER = '[data-test-id="TIMECODE_SLIDER"]';
const TIMECODE = '[data-test-id="VIBE_PLAYERBAR_TIMECODE"]';

const MARK = 'data-kotamusic-lyrics';
const PANEL = 'data-kotamusic-lyrics-panel';

/** Строки текста. Рисунок строим узлами: разметкой он бы не появился. */
function iconNode() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 5h14M5 10h9M5 15h11M5 20h7');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');

  svg.appendChild(path);
  return svg;
}

let settings = {};
let current = null; // {title, artist, lines, source}
let lines = [];
let active = -1;

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

function timecode() {
  // Ползунков на странице бывает несколько (панель и полноэкранный вид);
  // берём тот, у которого есть длительность и он на виду.
  const sliders = [...document.querySelectorAll(SLIDER)].filter(
    (node) => Number(node.max) > 0 && node.getClientRects().length
  );

  const slider = sliders[sliders.length - 1] || document.querySelector(SLIDER);
  if (slider) {
    return { position: Number(slider.value) || 0, duration: Number(slider.max) || 0 };
  }

  const text = (document.querySelector(TIMECODE)?.textContent || '').split('/');
  const seconds = (part) =>
    String(part || '')
      .trim()
      .split(':')
      .map(Number)
      .reduce((total, value) => total * 60 + (value || 0), 0);

  return { position: seconds(text[0]), duration: seconds(text[1]) };
}

/** Что играет: название, исполнитель, альбом и длительность. */
function playing() {
  const bar = document.querySelector(BAR);
  if (!bar) return null;

  const titleNode = bar.querySelector(TITLE);
  const title = clean(titleNode);
  if (!title) return null;

  const artistNodes = bar.querySelectorAll(ARTIST).length
    ? bar.querySelectorAll(ARTIST)
    : document.querySelectorAll(ARTIST);

  const artist = [...artistNodes].map(clean).filter(Boolean).join(', ');
  const link = bar.querySelector('a[href*="trackId="],a[href*="/track/"]');
  const href = link?.getAttribute('href') || '';
  const trackId = /trackId=(\d+)/.exec(href)?.[1] || /\/track\/(\d+)/.exec(href)?.[1] || null;

  return { title, artist, trackId, duration: timecode().duration };
}

function panel() {
  return document.querySelector(`[${PANEL}]`);
}

function closePanel() {
  panel()?.remove();
}

function buildPanel() {
  closePanel();

  const box = document.createElement('div');
  box.setAttribute(PANEL, '1');
  box.style.cssText =
    'position:fixed;right:16px;bottom:96px;z-index:2147483645;width:360px;max-height:60vh;' +
    'display:flex;flex-direction:column;border-radius:16px;background:rgba(24,24,24,.97);' +
    'color:#fff;box-shadow:0 12px 40px rgba(0,0,0,.5);font:14px/1.5 system-ui,sans-serif;' +
    '-webkit-app-region:no-drag;overflow:hidden';

  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)';

  const name = document.createElement('div');
  name.setAttribute('data-role', 'name');
  name.style.cssText = 'flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

  const source = document.createElement('div');
  source.setAttribute('data-role', 'source');
  source.style.cssText = 'font-size:11px;opacity:.5;white-space:nowrap';

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.title = 'Закрыть';
  close.style.cssText =
    'border:none;background:none;color:inherit;cursor:pointer;font-size:14px;opacity:.6;padding:0 2px';
  close.addEventListener('click', closePanel);

  head.append(name, source, close);

  const body = document.createElement('div');
  body.setAttribute('data-role', 'body');
  body.style.cssText = 'padding:12px 14px 16px;overflow-y:auto;scroll-behavior:smooth';

  box.append(head, body);
  document.body.appendChild(box);
  return box;
}

function renderLines(box) {
  const body = box.querySelector('[data-role="body"]');
  body.textContent = '';
  active = -1;

  if (!current) {
    body.textContent = 'Текста нет ни у Яндекса, ни в LRCLib.';
    body.style.opacity = '.6';
    return;
  }

  box.querySelector('[data-role="name"]').textContent = `${current.title} — ${current.artist}`;
  box.querySelector('[data-role="source"]').textContent = current.source;
  body.style.opacity = '1';

  if (!current.synced) {
    const plain = document.createElement('div');
    plain.style.whiteSpace = 'pre-wrap';
    plain.textContent = current.text || '';
    body.appendChild(plain);
    return;
  }

  lines = current.lines;

  for (const line of lines) {
    const node = document.createElement('div');
    node.textContent = line.text || '⋯';
    node.style.cssText = 'padding:3px 0;opacity:.45;transition:opacity .2s,color .2s';
    body.appendChild(node);
  }
}

/** Подсветка строки по времени трека. */
function highlight() {
  const box = panel();
  if (!box || !current?.synced || !lines.length) return;

  const { position } = timecode();
  const nodes = box.querySelectorAll('[data-role="body"] > div');
  if (nodes.length !== lines.length) return;

  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= position + 0.15) index = i;
    else break;
  }

  // Строку красим всегда, а не только при её смене: после перемотки
  // клиент перерисовывает панель, и прежняя подсветка пропадала.
  const moved = index !== active;
  active = index;

  nodes.forEach((node, i) => {
    const on = i === index;
    node.style.opacity = on ? '1' : '.45';
    node.style.color = on ? '#ffdb4d' : '';
    node.style.fontWeight = on ? '600' : '';

    // Прокручиваем, только когда строка сменилась и мышь не на панели:
    // иначе панель дёргалась бы под курсором при чтении.
    if (on && moved && !box.matches(':hover')) node.scrollIntoView({ block: 'center' });
  });
}

async function openPanel() {
  const track = playing();
  if (!track) return;

  const box = buildPanel();
  box.querySelector('[data-role="name"]').textContent = `${track.title} — ${track.artist}`;
  box.querySelector('[data-role="body"]').textContent = 'Ищу текст…';

  current = await ipcRenderer.invoke('kotamusic:lyrics:get', track);
  if (current) current = { ...current, title: track.title, artist: track.artist };

  if (!panel()) return; // успели закрыть
  renderLines(panel());
  highlight();
}

/** Кнопка рядом с кнопкой скачивания. */
function buildButton() {
  const anchor = document.querySelector(QUALITY_BUTTON);
  if (!anchor?.parentElement) return;

  const shown = document.querySelector(`[${MARK}]`);
  if (shown && shown.parentElement === anchor.parentElement) return;
  shown?.remove();

  const button = anchor.cloneNode(true);
  button.setAttribute(MARK, '1');
  button.removeAttribute('data-test-id');
  button.removeAttribute('aria-haspopup');
  button.removeAttribute('aria-expanded');
  button.title = 'Текст песни (Яндекс или LRCLib)';
  button.setAttribute('aria-label', 'Текст песни');
  button.replaceChildren(iconNode());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (panel()) closePanel();
    else openPanel();
  });

  anchor.parentElement.insertBefore(button, anchor);
}

function start() {
  // Пункт меню «Текст песни» просит открыть панель — он живёт в соседнем
  // сценарии, поэтому сговариваемся через событие страницы.
  document.addEventListener('kotamusic:lyrics:toggle', () => {
    if (panel()) closePanel();
    else openPanel();
  });

  // Проверка без мыши: открыть панель и рассказывать, что подсвечено.
  ipcRenderer.on('kotamusic:lyrics:open', () => {
    openPanel();

    setInterval(() => {
      if (!panel() || !current?.synced) return;

      ipcRenderer.send('kotamusic:debug:probe', {
        время: Math.round(timecode().position),
        строка: active,
        текст: (lines[active] || {}).text || '—',
      });
    }, 2000);
  });

  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    settings = state?.values || {};

    let shownFor = null;

    const tick = () => {
      if (settings.lyricsButton === false) {
        document.querySelector(`[${MARK}]`)?.remove();
        closePanel();
        return;
      }

      buildButton();

      // Сменился трек — перечитываем текст, если панель открыта.
      const track = playing();
      const key = track ? `${track.title}|${track.artist}` : null;

      if (panel() && key && key !== shownFor) {
        shownFor = key;
        openPanel();
      } else if (!panel()) {
        shownFor = key;
      }
    };

    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
    setInterval(tick, 1000);
    setInterval(highlight, 250);
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
