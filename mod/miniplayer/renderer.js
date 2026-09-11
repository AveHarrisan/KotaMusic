'use strict';
// Окно мини-плеера. Данные приходят из главного процесса, команды уходят
// туда же — сюда не тянем ни состояние клиента, ни его вёрстку.

const { ipcRenderer } = require('electron');

const el = (id) => document.getElementById(id);

const clock = (seconds) => {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

let duration = null;
let options = { seek: true, volume: true, close: true };

let hasTrack = false;

function render(track) {
  hasTrack = Boolean(track);

  if (!track) {
    el('title').textContent = 'Ничего не играет';
    el('artist').textContent = '';
    el('cover').removeAttribute('src');
    el('progress').firstElementChild.style.width = '0';
    el('time').textContent = '';
    return;
  }

  el('title').textContent = track.title;
  el('title').title = track.title;

  const artists = (track.artists || []).join(', ');
  el('artist').textContent = artists;
  el('artist').title = artists;

  if (track.cover) el('cover').src = track.cover;
  el('play').textContent = track.isPlaying ? '⏸' : '▶';

  duration = track.duration;
  update(track.position);
}

function update(position) {
  if (!Number.isFinite(position)) return;

  el('time').textContent = duration ? `${clock(position)} / ${clock(duration)}` : clock(position);
  el('progress').firstElementChild.style.width = duration
    ? `${Math.min(100, (position / duration) * 100)}%`
    : '0';
}

document.addEventListener('click', (event) => {
  if (event.target.closest('#close')) {
    return ipcRenderer.send('kotamusic:miniplayer:close');
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) ipcRenderer.send('kotamusic:miniplayer:action', action);
});

ipcRenderer.on('kotamusic:miniplayer:track', (_event, track) => render(track));

ipcRenderer.on('kotamusic:miniplayer:options', (_event, next) => {
  options = next;

  el('volume').hidden = !options.volume;
  el('close').hidden = !options.close;
  if (options.seek) el('seek').dataset.seekable = '1';
  else delete el('seek').dataset.seekable;
});

// Перемотка: щелчок по полосе задаёт позицию.
el('seek').addEventListener('click', (event) => {
  if (!options.seek || !duration) return;

  const box = el('progress').getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  ipcRenderer.send('kotamusic:miniplayer:action', { type: 'seek', value: ratio });
});

el('volume').addEventListener('input', (event) => {
  ipcRenderer.send('kotamusic:miniplayer:action', {
    type: 'volume',
    value: Number(event.target.value),
  });
});
ipcRenderer.on('kotamusic:miniplayer:tick', (_event, tick) => {
  // Без трека показывать время не от чего.
  if (!hasTrack) return;

  update(tick.position);

  // Пока ползунок тянут мышью, не перебиваем его значение.
  if (Number.isFinite(tick.volume) && document.activeElement !== el('volume')) {
    el('volume').value = String(tick.volume);
  }

  if (typeof tick.isPlaying === 'boolean') el('play').textContent = tick.isPlaying ? '⏸' : '▶';
});

ipcRenderer.send('kotamusic:miniplayer:ready');
