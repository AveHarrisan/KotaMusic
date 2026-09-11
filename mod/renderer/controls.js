'use strict';
// Управление плеером и показ громкости.
//
// Команды из главного процесса выполняем нажатием на родные кнопки:
// внутреннее состояние плеера спрятано в минифицированном коде, а метки
// кнопок стабильны — ими пользуются автотесты клиента.

const { ipcRenderer } = require('electron');

const ID = {
  play: ['PLAY_BUTTON', 'PAUSE_BUTTON'],
  next: ['NEXT_TRACK_BUTTON'],
  previous: ['PREVIOUS_TRACK_BUTTON'],
  like: ['LIKE_BUTTON'],
  volume: ['CHANGE_VOLUME_SLIDER'],
};

const bar = () =>
  document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"], [data-test-id="VIBE_PLAYERBAR"]') ||
  document;

const find = (ids) => bar().querySelector(ids.map((id) => `[data-test-id="${id}"]`).join(','));

/** Сдвигает громкость и уведомляет клиент, будто её тянули мышью. */
function changeVolume(delta) {
  const slider = document.querySelector('[data-test-id="CHANGE_VOLUME_SLIDER"]');
  if (!slider) return null;

  const max = Number(slider.max) || 1;
  const step = max * delta;
  const value = Math.min(max, Math.max(0, Number(slider.value) + step));

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(slider, String(value));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));

  return value / max;
}

ipcRenderer.on('kotamusic:action', (_event, action) => {
  try {
    if (action === 'volumeUp' || action === 'volumeDown') {
      const level = changeVolume(action === 'volumeUp' ? 0.05 : -0.05);
      if (level !== null) showVolume(level);
      return;
    }

    find(ID[action])?.click();
  } catch (e) {
    console.error('[KotaMusic] не удалось выполнить', action, e);
  }
});

// --- Показ громкости ---------------------------------------------------

let badge = null;
let hideTimer = null;

function ensureBadge() {
  if (badge?.isConnected) return badge;

  badge = document.createElement('div');
  badge.dataset.kotamusicVolume = '1';
  badge.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;opacity:0;' +
    'transition:opacity .15s;padding:4px 8px;border-radius:8px;' +
    'font:600 12px/1 system-ui,sans-serif;color:#000;background:#ffdb4d;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.35)';

  document.body.appendChild(badge);
  return badge;
}

/** Показывает процент рядом с ползунком громкости. */
function showVolume(level) {
  const node = ensureBadge();
  node.textContent = `${Math.round(level * 100)}%`;

  const slider = document.querySelector('[data-test-id="CHANGE_VOLUME_SLIDER"]');
  const box = slider?.getBoundingClientRect();

  if (box && box.width) {
    node.style.left = `${Math.max(8, box.left + box.width / 2 - 20)}px`;
    node.style.top = `${Math.max(8, box.top - 28)}px`;
  } else {
    node.style.left = '';
    node.style.right = '16px';
    node.style.top = '';
    node.style.bottom = '96px';
  }

  node.style.opacity = '1';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => (node.style.opacity = '0'), 1200);
}

/** Следим за ползунком: процент нужен и когда громкость меняют мышью. */
function watchVolume() {
  let last = null;

  const check = () => {
    const slider = document.querySelector('[data-test-id="CHANGE_VOLUME_SLIDER"]');
    if (!slider) return;

    const level = Number(slider.value) / (Number(slider.max) || 1);
    if (last !== null && Math.abs(level - last) > 0.001) showVolume(level);
    last = level;
  };

  document.addEventListener('input', check, true);
  document.addEventListener('wheel', () => setTimeout(check, 30), true);
  setInterval(check, 400);
}

function start() {
  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    if (state?.values?.showVolumePercent !== false) watchVolume();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
