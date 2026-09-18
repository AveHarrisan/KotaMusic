'use strict';
// Мелкие правки внешнего вида панели плеера.
//
// Делаем стилями, а не врезками в код: правила цепляются за начало имени
// класса (`ChangeTimecode_timecode__`), а хвост с хешем меняется от сборки
// к сборке клиента. Так правки переживают обновления, ничего не ломая.

const { ipcRenderer } = require('electron');

const STYLE_ID = 'kotamusic-player-bar';

const RULES = {
  // Время трека клиент показывает только при наведении.
  playerAlwaysTimecode: `
    [class*="ChangeTimecode_timecode__"] { opacity: 1 !important; }
  `,

  // Панель перекрашивается под средний цвет обложки. Кому-то это мешает
  // читать текст — возвращаем ровный тёмный фон.
  playerFlatColors: `
    [style*="--player-average-color-background"] {
      --player-average-color-background: var(--ym-background-color-primary-enabled, #1c1c1c) !important;
    }
  `,

  // Полоса времени тонкая; по ней же перематывают, и попасть непросто.
  playerThickBar: `
    [class*="ChangeTimecodeBackground_progressbar__"] { height: .5rem !important; }
  `,
};

// Правки, которые нужны всегда, без настроек.
const BASE = `
  /* Окно «Настройки звука» выезжает вплотную к нижнему краю и налезает
     на ряд кнопок мода. Отодвигаем его отступом — сдвигать переносом
     нельзя: у окна внутри своя привязка, и оно уезжает за край экрана. */
  [class*="QualitySettingsModal_root"] { margin-bottom: 40px; }
`;

let values = {};

function apply() {
  if (!document.head) return;

  const css = [
    BASE,
    ...Object.entries(RULES)
      .filter(([setting]) => values[setting])
      .map(([, rule]) => rule),
  ].join('\n');

  let style = document.getElementById(STYLE_ID);

  if (!css.trim()) {
    style?.remove();
    return;
  }

  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = css;
}

try {
  values = ipcRenderer.sendSync('kotamusic:settings:sync') || {};
} catch {
  // Мод в клиенте не запустился — внешний вид не трогаем.
}

apply();
document.addEventListener('DOMContentLoaded', apply);

ipcRenderer.on('kotamusic:settings:changed', (_event, next) => {
  values = next || {};
  apply();
});
