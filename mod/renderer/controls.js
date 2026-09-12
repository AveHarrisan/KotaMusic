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
  // У повтора три состояния, у перемешивания два — метка кнопки
  // меняется вместе с ними, поэтому перечисляем все.
  repeat: ['REPEAT_BUTTON_NO_REPEAT', 'REPEAT_BUTTON_REPEAT_CONTEXT', 'REPEAT_BUTTON_REPEAT_ONE'],
  shuffle: ['SHUFFLE_BUTTON', 'SHUFFLE_BUTTON_ON'],
  volume: ['CHANGE_VOLUME_SLIDER'],
};

const bar = () =>
  document.querySelector('[data-test-id="PLAYERBAR_DESKTOP"], [data-test-id="VIBE_PLAYERBAR"]') ||
  document;

/**
 * Нажатие как настоящей мышью. Часть кнопок клиента слушает события
 * указателя, а не «клик», и на программный click не реагирует.
 */
function press(element) {
  if (!element) return;

  const box = element.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    button: 0,
    buttons: 1,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  element.dispatchEvent(new PointerEvent('pointerdown', options));
  element.dispatchEvent(new MouseEvent('mousedown', options));
  element.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...options, buttons: 0 }));
}

/**
 * Ищем кнопку плеера, а не такую же кнопку в карточке из списка.
 * В «Моей волне» часть кнопок вынесена за пределы панели, поэтому
 * поднимаемся от панели вверх до ближайшего предка, где кнопка есть.
 */
function find(ids) {
  const selector = ids.map((id) => `[data-test-id="${id}"]`).join(',');

  let node = bar();
  for (let depth = 0; node && depth < 8; depth++) {
    const found = node.querySelector(selector);
    if (found) return found;
    node = node.parentElement;
  }

  return document.querySelector(selector);
}

/** Двигает ползунок так, как это делает мышь: через события ввода. */
function setSliderElement(slider, ratio) {
  if (!slider) return null;

  const max = Number(slider.max) || 1;
  const value = Math.min(max, Math.max(0, max * ratio));

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(slider, String(value));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));

  return value / max;
}

const setSlider = (selector, ratio) =>
  setSliderElement(document.querySelector(selector), ratio);

const VOLUME = '[data-test-id="CHANGE_VOLUME_SLIDER"]';
/** Ползунок времени: в «Моей волне» он лежит рядом с подписью времени. */
function timecodeSlider() {
  const direct = document.querySelector('[data-test-id="TIMECODE_SLIDER"]');
  if (direct) return direct;

  const label = document.querySelector('[data-test-id="VIBE_PLAYERBAR_TIMECODE"]');
  return label?.parentElement?.querySelector('input[type="range"]') ?? null;
}

function currentVolume() {
  const slider = document.querySelector(VOLUME);
  if (!slider) return 0;
  return Number(slider.value) / (Number(slider.max) || 1);
}

function changeVolume(delta) {
  return setSlider(VOLUME, currentVolume() + delta);
}

ipcRenderer.on('kotamusic:action', (_event, action) => {
  try {
    // Команды со значением: громкость и перемотка.
    if (action && typeof action === 'object') {
      if (action.type === 'volume') {
        const level = setSlider(VOLUME, action.value);
        if (level !== null) showVolume(level);
      }
      if (action.type === 'seek') setSliderElement(timecodeSlider(), action.value);
      return;
    }

    if (action === 'volumeUp' || action === 'volumeDown') {
      const level = changeVolume(action === 'volumeUp' ? 0.05 : -0.05);
      if (level !== null) showVolume(level);
      return;
    }

    const button = find(ID[action]);
    ipcRenderer.send('kotamusic:debug:probe', {
      действие: action,
      кнопка: button?.getAttribute('data-test-id') ?? 'не найдена',
      наПанели: Boolean(bar()?.contains?.(button)),
      подпись: button?.getAttribute('aria-label') ?? null,
    });

    press(button);
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

  // Ползунок бывает и на экране, и спрятанным за краем окна: во втором
  // случае привязываться к нему нельзя — подпись уедет из виду.
  const visible =
    box &&
    box.width > 0 &&
    box.height > 0 &&
    box.top > 40 &&
    box.bottom < window.innerHeight &&
    box.left > 0 &&
    box.right < window.innerWidth;

  if (visible) {
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

/**
 * Колесо над регулятором громкости: клиент меняет её крупными шагами,
 * а нам нужен свой, из настроек.
 */
function ownVolumeWheel(step) {
  document.addEventListener(
    'wheel',
    (event) => {
      const target = event.target.closest(
        '[data-test-id="CHANGE_VOLUME_SLIDER"],[data-test-id="CHANGE_VOLUME_BUTTON"]'
      );
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();

      const level = changeVolume((event.deltaY < 0 ? 1 : -1) * (step / 100));
      if (level !== null) showVolume(level);
    },
    { capture: true, passive: false }
  );
}

function start() {
  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    const values = state?.values ?? {};

    if (values.showVolumePercent !== false) watchVolume();
    ownVolumeWheel(Math.max(1, Math.min(25, Number(values.volumeStep) || 1)));
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
