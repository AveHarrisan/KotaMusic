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

function render(track) {
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
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) ipcRenderer.send('kotamusic:miniplayer:action', action);
});

ipcRenderer.on('kotamusic:miniplayer:track', (_event, track) => render(track));
ipcRenderer.on('kotamusic:miniplayer:tick', (_event, position) => update(position));

ipcRenderer.send('kotamusic:miniplayer:ready');
