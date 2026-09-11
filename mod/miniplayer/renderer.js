'use strict';
// Окно мини-плеера. Данные приходят из главного процесса, команды уходят
// туда же — сюда не тянем ни состояние клиента, ни его вёрстку.

const { ipcRenderer } = require('electron');

const el = (id) => document.getElementById(id);

// Когда играть нечего, вместо пустого квадрата показываем маскот.
const PLACEHOLDER = '../assets/cover-placeholder.svg';

const clock = (seconds) => {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

let duration = null;
let options = { seek: true, volume: true, close: true, compact: false, volumeStep: 1 };
let lastTrack = null;

let hasTrack = false;

function render(track) {
  lastTrack = track;
  hasTrack = Boolean(track);

  if (!track) {
    setTitle('Ничего не играет');
    el('artist').textContent = '';
    el('cover').src = PLACEHOLDER;
    el('progress').firstElementChild.style.width = '0';
    el('time').textContent = '';
    return;
  }

  const artists = (track.artists || []).join(', ');

  // В компактном виде исполнителя прячем в ту же строку: места мало,
  // а знать, кто играет, всё равно хочется.
  setTitle(options.compact && artists ? `${track.title} — ${artists}` : track.title);

  el('artist').textContent = artists;
  el('artist').title = artists;

  el('cover').src = track.cover || PLACEHOLDER;
  el('play').textContent = track.isPlaying ? '⏸' : '▶';

  duration = track.duration;
  update(track.position);
}

/** Ставит строку названия и пускает её бегущей, если не помещается. */
function setTitle(text) {
  const node = el('title');
  node.title = text;

  node.classList.remove('scroll');
  node.textContent = text;

  // Сравниваем ширину текста с шириной окна уже после отрисовки.
  requestAnimationFrame(() => {
    if (node.scrollWidth <= node.clientWidth + 1) return;

    const span = document.createElement('span');
    span.textContent = text;

    const copy = span.cloneNode(true);
    node.textContent = '';
    node.append(span, copy);
    node.classList.add('scroll');

    // Скорость постоянная: длинная строка едет дольше, а не быстрее.
    const seconds = Math.max(6, Math.round(span.scrollWidth / 22));
    span.style.animationDuration = `${seconds}s`;
    copy.style.animationDuration = `${seconds}s`;
  });
}

function update(position) {
  if (!Number.isFinite(position)) return;

  el('time').textContent = duration ? `${clock(position)} / ${clock(duration)}` : clock(position);
  el('progress').firstElementChild.style.width = duration
    ? `${Math.min(100, (position / duration) * 100)}%`
    : '0';
}

let volumeTimer = null;
let labelTimer = null;
let lastVolume = null;

/** Короткая подсказка с процентом над полосой прогресса. */
function flashVolume(level) {
  const label = el('volume-label');
  label.textContent = `${Math.round(level * 100)}%`;
  label.classList.add('show');

  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => label.classList.remove('show'), 1400);
}

/** Ползунок громкости прячется сам, чтобы не занимать место. */
function showVolume(open = true) {
  el('volume').classList.toggle('open', open);

  clearTimeout(volumeTimer);
  if (open) volumeTimer = setTimeout(() => el('volume').classList.remove('open'), 3000);
}

let closeArmed = null;

document.addEventListener('click', (event) => {
  if (event.target.closest('#close')) {
    // Случайно закрыть окно легко, поэтому первое нажатие только
    // подсвечивает крестик, а закрывает второе.
    if (closeArmed) {
      clearTimeout(closeArmed);
      closeArmed = null;
      return ipcRenderer.send('kotamusic:miniplayer:close');
    }

    el('close').classList.add('armed');
    el('close').title = 'Нажмите ещё раз, чтобы закрыть';

    closeArmed = setTimeout(() => {
      closeArmed = null;
      el('close').classList.remove('armed');
      el('close').title = 'Закрыть мини-плеер';
    }, 3000);

    return;
  }

  if (event.target.closest('[data-action="volume-toggle"]')) {
    return showVolume(!el('volume').classList.contains('open'));
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) ipcRenderer.send('kotamusic:miniplayer:action', action);
});

ipcRenderer.on('kotamusic:miniplayer:track', (_event, track) => render(track));

ipcRenderer.on('kotamusic:miniplayer:options', (_event, next) => {
  options = next;

  document.body.toggleAttribute('data-compact', Boolean(options.compact));

  // Вид сменился — строку названия надо собрать заново.
  render(lastTrack);

  el('volume').hidden = !options.volume;
  el('volume-button').hidden = !options.volume;
  if (!options.volume) el('volume').classList.remove('open');
  el('close').hidden = !options.close;
  if (options.seek) el('seek').dataset.seekable = '1';
  else delete el('seek').dataset.seekable;
});

ipcRenderer.on('kotamusic:miniplayer:lock', (_event, state) => {
  el('countdown').textContent = state.remaining ? `${state.remaining} с` : '';
});

// Подсветка места перемотки: кружок следует за курсором.
el('seek').addEventListener('mousemove', (event) => {
  if (!options.seek || !duration) return;

  const box = el('progress').getBoundingClientRect();
  const x = Math.min(box.width, Math.max(0, event.clientX - box.left));

  el('seek-knob').style.left = `${x}px`;
  el('seek-knob').title = clock((x / box.width) * duration);
});

// Перемотка: щелчок по полосе задаёт позицию.
el('seek').addEventListener('click', (event) => {
  if (!options.seek || !duration) return;

  const box = el('progress').getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  ipcRenderer.send('kotamusic:miniplayer:action', { type: 'seek', value: ratio });
});

el('volume').addEventListener('input', (event) => {
  showVolume();
  flashVolume(Number(event.target.value));
  ipcRenderer.send('kotamusic:miniplayer:action', {
    type: 'volume',
    value: Number(event.target.value),
  });
});

// Колесо над кнопкой громкости тоже меняет её — привычно и быстро.
document.addEventListener(
  'wheel',
  (event) => {
    if (!options.volume) return;
    if (!event.target.closest('#volume-button, #volume')) return;

    const step = (event.deltaY < 0 ? 1 : -1) * ((options.volumeStep || 1) / 100);
    const value = Math.min(1, Math.max(0, Number(el('volume').value || 0) + step));

    el('volume').value = String(value);
    showVolume();
    flashVolume(value);
    ipcRenderer.send('kotamusic:miniplayer:action', { type: 'volume', value });
  },
  { passive: true }
);
ipcRenderer.on('kotamusic:miniplayer:tick', (_event, tick) => {
  // Без трека показывать время не от чего.
  if (!hasTrack) return;

  update(tick.position);

  // Пока ползунок тянут мышью, не перебиваем его значение.
  if (Number.isFinite(tick.volume) && document.activeElement !== el('volume')) {
    // Громкость могли изменить и в самом клиенте, и горячими клавишами.
    if (lastVolume !== null && Math.abs(tick.volume - lastVolume) > 0.001) {
      flashVolume(tick.volume);
    }
    lastVolume = tick.volume;

    el('volume').value = String(tick.volume);
    el('volume-button').textContent = tick.volume < 0.01 ? '🔇' : tick.volume < 0.5 ? '🔉' : '🔊';
  }

  if (typeof tick.isPlaying === 'boolean') el('play').textContent = tick.isPlaying ? '⏸' : '▶';
});

ipcRenderer.send('kotamusic:miniplayer:ready');
