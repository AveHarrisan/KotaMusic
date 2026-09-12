'use strict';
// Плашка «сейчас играет» для трансляции.
//
// Отдаём компактную страницу на локальном адресе: её добавляют в OBS
// источником «Браузер». Наружу не выходим — слушаем только 127.0.0.1,
// чтобы плеер не оказался виден из сети.

const http = require('http');

const settings = require('./settings');
const log = require('./log');

const HOST = '127.0.0.1';

let server = null;
let listeners = new Set();

let track = null;
let position = null;

const port = () => Math.min(65535, Math.max(1024, Number(settings.get().streamPort) || 8462));

/** Адрес, который человек вставляет в OBS. */
const address = () => `http://${HOST}:${port()}/`;

/** То, что видит страница: трек, позиция и настройки показа. */
/** Число из настроек в разумных пределах. */
const clamp = (value, min, max, fallback) =>
  Math.min(max, Math.max(min, Number(value) || fallback));

function view() {
  const config = settings.get();

  // Цвет принимаем только в виде #rgb или #rrggbb: страницу собираем
  // сами, и чужая строка в стилях нам ни к чему.
  const accent = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(config.streamAccent || ''))
    ? config.streamAccent
    : '#ffdb4d';

  return {
    cover: config.streamCover !== false,
    coverSize: clamp(config.streamCoverSize, 32, 160, 56),
    bar: config.streamBar !== false,
    time: Boolean(config.streamTime),
    background: ['dark', 'light', 'none'].includes(config.streamBackground)
      ? config.streamBackground
      : 'dark',
    accent,
    fontSize: clamp(config.streamFontSize, 10, 48, 16),
    width: clamp(config.streamWidth, 240, 1920, 560),
  };
}

function payload() {
  return {
    view: view(),
    playing: Boolean(track?.isPlaying),
    title: track?.title || '',
    artists: track?.artists || [],
    cover: track?.cover || '',
    position: position?.position ?? track?.position ?? null,
    duration: position?.duration ?? track?.duration ?? null,
  };
}

function push() {
  if (!listeners.size) return;

  const line = `data: ${JSON.stringify(payload())}\n\n`;

  for (const response of listeners) {
    try {
      response.write(line);
    } catch {
      listeners.delete(response);
    }
  }
}

/**
 * Страница плашки. Фон прозрачный: в OBS поверх видео нужен только сам
 * блок, а не чёрный прямоугольник вокруг него.
 */
function page() {
  return `<!doctype html>
<meta charset="utf-8">
<title>KotaMusic — сейчас играет</title>
<style>
  html, body { margin: 0; background: transparent; }

  body {
    font: 16px/1.3 "Segoe UI", system-ui, sans-serif;
    color: #fff;
    -webkit-font-smoothing: antialiased;
  }

  /* Подложка полупрозрачная: поверх светлого видео текст иначе теряется. */
  .card {
    display: flex;
    align-items: center;
    gap: 14px;
    width: max-content;
    padding: 12px 18px 12px 12px;
    border-radius: 14px;
    background: rgba(20, 20, 20, .72);
    box-shadow: 0 6px 22px rgba(0, 0, 0, .35);
  }

  .card.idle { display: none; }

  /* Светлый вид — для трансляций со светлой картинкой. */
  .card.light { background: rgba(245, 245, 245, .82); color: #141414; }
  .card.light .artist { opacity: .6; }
  .card.light .bar { background: rgba(0, 0, 0, .16); }

  /* Без подложки остаётся только текст: чтобы он читался на любом видео,
     добавляем обводку и тень. */
  .card.plain {
    background: none;
    box-shadow: none;
    padding: 0;
    text-shadow: 0 2px 6px rgba(0, 0, 0, .85), 0 0 2px rgba(0, 0, 0, .9);
  }

  .card.plain .bar { background: rgba(255, 255, 255, .35); }

  /* Без обложки плашка становится узкой строкой. */
  .card.nocover img { display: none; }
  .card.nobar .bar { display: none; }

  .time {
    margin-top: 6px;
    font-size: .8em;
    opacity: .7;
    font-variant-numeric: tabular-nums;
  }

  .card.notime .time { display: none; }

  img {
    width: 56px;
    height: 56px;
    border-radius: 10px;
    object-fit: cover;
    flex: none;
    background: rgba(255, 255, 255, .08);
  }

  .text { min-width: 0; }

  .title {
    font-weight: 700;
    font-size: 1.06em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artist {
    margin-top: 2px;
    opacity: .75;
    font-size: .88em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar {
    margin-top: 8px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, .18);
    overflow: hidden;
  }

  .bar div {
    height: 100%;
    width: 0;
    background: var(--accent, #ffdb4d);
    transition: width .4s linear;
  }
</style>

<div class="card idle" id="card">
  <img id="cover" alt="">
  <div class="text">
    <div class="title" id="title"></div>
    <div class="artist" id="artist"></div>
    <div class="bar"><div id="progress"></div></div>
    <div class="time" id="time"></div>
  </div>
</div>

<script>
  const el = (id) => document.getElementById(id);

  const clock = (seconds) => {
    if (!Number.isFinite(seconds)) return '';
    const total = Math.max(0, Math.round(seconds));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  };

  function render(data) {
    const view = data.view || {};
    const card = el('card');

    document.body.style.fontSize = (view.fontSize || 16) + 'px';
    card.style.maxWidth = (view.width || 560) + 'px';
    card.style.setProperty('--accent', view.accent || '#ffdb4d');

    el('cover').style.width = (view.coverSize || 56) + 'px';
    el('cover').style.height = (view.coverSize || 56) + 'px';

    card.classList.toggle('light', view.background === 'light');
    card.classList.toggle('plain', view.background === 'none');
    card.classList.toggle('nocover', view.cover === false);
    card.classList.toggle('nobar', view.bar === false);
    card.classList.toggle('notime', !view.time);

    // Играть нечего — плашку прячем целиком: пустая карточка в кадре
    // выглядит так, будто трансляция сломалась.
    el('card').classList.toggle('idle', !data.title);
    if (!data.title) return;

    el('title').textContent = data.title;
    el('artist').textContent = (data.artists || []).join(', ');

    if (data.cover) el('cover').src = data.cover;
    el('cover').hidden = !data.cover;

    const ratio = data.duration ? Math.min(1, (data.position || 0) / data.duration) : 0;
    el('progress').style.width = (ratio * 100).toFixed(1) + '%';

    el('time').textContent = data.duration
      ? clock(data.position || 0) + ' / ' + clock(data.duration)
      : '';
  }

  // Обрыв связи — это закрытый клиент: EventSource сам переподключится,
  // и плашка оживёт, когда мод снова заработает.
  const source = new EventSource('/events');
  source.onmessage = (event) => render(JSON.parse(event.data));
</script>
`;
}

function handle(request, response) {
  const url = request.url.split('?')[0];

  if (url === '/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    response.write(`data: ${JSON.stringify(payload())}\n\n`);
    listeners.add(response);

    request.on('close', () => listeners.delete(response));
    return;
  }

  if (url === '/now.json') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return response.end(JSON.stringify(payload()));
  }

  if (url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return response.end(page());
  }

  response.writeHead(404);
  response.end();
}

function stop() {
  for (const response of listeners) {
    try {
      response.end();
    } catch {}
  }

  listeners = new Set();

  if (server) {
    server.close();
    server = null;
    log.info('Трансляция выключена');
  }
}

function listen() {
  stop();

  server = http.createServer(handle);

  server.on('error', (e) => {
    // Занятый порт — обычное дело: рядом может работать что угодно.
    log.warn('Трансляция не поднялась:', e.message);
    server = null;
    settings.set({ stream: false });
  });

  server.listen(port(), HOST, () => log.info('Трансляция на', address()));
}

function setTrack(value) {
  track = value;
  if (!value) position = null;
  push();
}

function setPosition(value) {
  position = value;
  push();
}

function start() {
  settings.onChange((now, before) => {
    if (now.stream !== before.stream) return now.stream ? listen() : stop();
    if (now.stream && now.streamPort !== before.streamPort) return listen();

    // Внешний вид плашки уезжает в уже открытую страницу — в OBS её
    // перезагружать не придётся.
    const looks = [
      'streamCover',
      'streamCoverSize',
      'streamBar',
      'streamTime',
      'streamBackground',
      'streamAccent',
      'streamFontSize',
      'streamWidth',
    ];

    if (looks.some((key) => now[key] !== before[key])) push();
  });

  if (settings.get().stream) listen();
}

module.exports = { start, setTrack, setPosition, address, stop };
