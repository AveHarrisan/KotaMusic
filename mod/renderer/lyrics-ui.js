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
  let title = clean(titleNode);
  if (!title) return null;

  const artistNodes = bar.querySelectorAll(ARTIST).length
    ? bar.querySelectorAll(ARTIST)
    : document.querySelectorAll(ARTIST);

  let artist = [...artistNodes].map(clean).filter(Boolean).join(', ');

  // В «Моей волне» исполнителя отдельно нет, а название приходит
  // склейкой «Исполнитель —Название». С такой склейкой текст не ищется.
  const cut = title.indexOf(' —');
  if (cut > 0 && cut + 2 < title.length) {
    const head = title.slice(0, cut).trim();
    const rest = title.slice(cut + 2).trim();

    if (!artist || head === artist) {
      title = rest;
      artist = artist || head;
    }
  }
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

// Размеры по умолчанию и самые маленькие, до которых можно сжать.
const DEFAULT_BOX = { width: 360, height: 420 };
const MIN_BOX = { width: 240, height: 160 };

let saved = null; // где панель стояла в прошлый раз
let fullscreen = false;

/** Размер шрифта в панели — из настроек. */
function fontSize() {
  const value = Number(settings.lyricsFontSize);
  return Number.isFinite(value) && value >= 10 && value <= 40 ? value : 15;
}

const headButton = (sign, title) => {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = sign;
  node.title = title;
  node.setAttribute('aria-label', title);
  node.style.cssText =
    'border:none;background:none;color:inherit;cursor:pointer;font-size:13px;' +
    'opacity:.6;padding:0 3px;line-height:1';
  node.addEventListener('mouseenter', () => (node.style.opacity = '1'));
  node.addEventListener('mouseleave', () => (node.style.opacity = '.6'));
  return node;
};

/** Ставит панель на место и размер: свои, запомненные или во весь экран. */
function applyBox(box) {
  if (fullscreen) {
    Object.assign(box.style, {
      left: '16px',
      top: '16px',
      right: 'auto',
      bottom: 'auto',
      width: `${window.innerWidth - 32}px`,
      height: `${window.innerHeight - 32}px`,
      maxHeight: 'none',
      resize: 'none',
    });

    // Во весь экран текст читают издалека: ставим по центру и крупнее.
    const wide = box.querySelector('[data-role="body"]');
    if (wide) {
      wide.style.textAlign = 'center';
      // Во весь экран читают издалека — шрифт крупнее выбранного.
      wide.style.fontSize = `${Math.round(fontSize() * 1.6)}px`;
      wide.style.padding = '10vh 8vw';
    }

    return;
  }

  const body = box.querySelector('[data-role="body"]');
  if (body) {
    body.style.textAlign = 'left';
    body.style.fontSize = `${fontSize()}px`;
    body.style.padding = '12px 14px 16px';
  }

  const place = saved || {
    left: Math.max(16, window.innerWidth - DEFAULT_BOX.width - 16),
    top: Math.max(16, window.innerHeight - DEFAULT_BOX.height - 96),
    ...DEFAULT_BOX,
  };

  Object.assign(box.style, {
    left: `${Math.round(place.left)}px`,
    top: `${Math.round(place.top)}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${Math.round(place.width)}px`,
    height: `${Math.round(place.height)}px`,
    maxHeight: 'none',
    resize: 'both',
  });
}

/** Запоминает, где панель стоит сейчас. */
function rememberBox(box) {
  if (fullscreen) return;

  const rect = box.getBoundingClientRect();

  // Мусорные значения не храним: панель не может быть крохотной
  // или прижатой к самому краю без участия человека.
  if (rect.width < MIN_BOX.width || rect.height < MIN_BOX.height) return;
  if (rect.left < 1 || rect.top < 1) return;
  saved = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  ipcRenderer.invoke('kotamusic:settings:set', { lyricsPanelBox: saved });
}

/** Перетаскивание за заголовок. */
function makeDraggable(box, handle) {
  handle.addEventListener('pointerdown', (event) => {
    // ⚠️Ползунок размера шрифта живёт в той же шапке. Без этой проверки
    // нажатие на него уводило панель в перетаскивание, и ползунок не
    // двигался вовсе — особенно заметно на узкой панели, где он маленький.
    if (fullscreen || event.target.closest('button, input, [data-role="sizer"]')) return;

    const rect = box.getBoundingClientRect();
    const shiftX = event.clientX - rect.left;
    const shiftY = event.clientY - rect.top;

    const move = (moveEvent) => {
      // Не даём утащить панель за край: иначе её не вернуть мышью.
      const left = Math.min(
        Math.max(0, moveEvent.clientX - shiftX),
        window.innerWidth - rect.width
      );
      const top = Math.min(
        Math.max(0, moveEvent.clientY - shiftY),
        window.innerHeight - rect.height
      );

      box.style.left = `${Math.round(left)}px`;
      box.style.top = `${Math.round(top)}px`;
    };

    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      rememberBox(box);
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    event.preventDefault();
  });

  handle.style.cursor = 'move';
}

function buildPanel() {
  closePanel();

  const box = document.createElement('div');
  box.setAttribute(PANEL, '1');
  box.style.cssText =
    'position:fixed;z-index:2147483645;' +
    `min-width:${MIN_BOX.width}px;min-height:${MIN_BOX.height}px;` +
    'display:flex;flex-direction:column;border-radius:16px;background:rgba(24,24,24,.97);' +
    'color:#fff;box-shadow:0 12px 40px rgba(0,0,0,.5);font:14px/1.5 system-ui,sans-serif;' +
    '-webkit-app-region:no-drag;overflow:hidden';

  const head = document.createElement('div');
  head.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:12px 14px;flex:none;' +
    'border-bottom:1px solid rgba(255,255,255,.08)';

  const name = document.createElement('div');
  name.setAttribute('data-role', 'name');
  name.style.cssText =
    'flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

  const source = document.createElement('div');
  source.setAttribute('data-role', 'source');
  source.style.cssText = 'font-size:11px;opacity:.5;white-space:nowrap;margin-right:4px';

  // Ползунок размера шрифта — как громкость: тянешь и сразу видишь.
  const sizer = document.createElement('input');
  sizer.setAttribute('data-role', 'sizer');
  sizer.type = 'range';
  sizer.min = '12';
  sizer.max = '32';
  sizer.step = '1';
  sizer.value = String(fontSize());
  sizer.title = 'Размер шрифта';
  sizer.style.cssText = 'width:74px;flex:none;accent-color:#ffdb4d;cursor:pointer';

  let saveSoon = null;
  sizer.addEventListener('input', () => {
    settings.lyricsFontSize = Number(sizer.value);
    applyBox(box);

    // Пишем в настройки не на каждое движение, а когда оно улеглось.
    clearTimeout(saveSoon);
    saveSoon = setTimeout(
      () => ipcRenderer.invoke('kotamusic:settings:set', { lyricsFontSize: Number(sizer.value) }),
      400
    );
  });

  const reset = headButton('⤢', 'Вернуть размер и место');
  reset.textContent = '⟲';
  reset.addEventListener('click', () => {
    fullscreen = false;
    saved = null;
    ipcRenderer.invoke('kotamusic:settings:set', { lyricsPanelBox: null });
    applyBox(box);
  });

  const expand = headButton('⛶', 'Во весь экран');
  expand.addEventListener('click', () => {
    fullscreen = !fullscreen;
    expand.textContent = fullscreen ? '🗗' : '⛶';
    expand.title = fullscreen ? 'Вернуть прежний размер' : 'Во весь экран';
    applyBox(box);
  });

  const close = headButton('✕', 'Закрыть');
  close.addEventListener('click', closePanel);

  head.append(name, source, sizer, reset, expand, close);

  const body = document.createElement('div');
  body.setAttribute('data-role', 'body');
  body.style.cssText = 'padding:12px 14px 16px;overflow-y:auto;scroll-behavior:smooth;flex:1;min-height:0';

  box.append(head, body);
  document.body.appendChild(box);

  applyBox(box);
  makeDraggable(box, head);

  if (settings.debug) {
    setTimeout(() => {
      const rect = box.getBoundingClientRect();
      ipcRenderer.send('kotamusic:debug:probe', {
        панель: `${Math.round(rect.width)}x${Math.round(rect.height)} в (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
        окно: `${window.innerWidth}x${window.innerHeight}`,
        стиль: box.style.cssText.slice(0, 200),
      });
    }, 500);
  }

  // Размер запоминаем, когда человек отпустил мышь: наблюдатель за
  // размером срабатывал и на наши же перестроения и сохранял ерунду.
  box.addEventListener('pointerup', () => setTimeout(() => rememberBox(box), 50));

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

  ipcRenderer.on('kotamusic:lyrics:full', () => {
    const box = panel();
    if (!box) return;

    fullscreen = !fullscreen;
    applyBox(box);
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

    // Панель встаёт туда же, где её оставили в прошлый раз.
    const box = settings.lyricsPanelBox;
    if (box && Number.isFinite(box.left) && Number.isFinite(box.top)) {
      saved = {
        left: box.left,
        top: box.top,
        width: Math.max(MIN_BOX.width, box.width || DEFAULT_BOX.width),
        height: Math.max(MIN_BOX.height, box.height || DEFAULT_BOX.height),
      };
    }

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
