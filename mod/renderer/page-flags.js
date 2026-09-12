'use strict';
// Признаки мода для кода страницы.
//
// Врезки в клиент читают их с корневого элемента: наш код работает
// в preload, у страницы своя область видимости, и общее у них только
// дерево документа.

const { ipcRenderer } = require('electron');

// Настройка мода → признак в data-атрибуте страницы.
const FLAGS = {
  liteVibeAnimation: 'kmLiteVibe',
  ynisonRemote: 'kmYnison',
};

let values = {};

function apply() {
  const root = document.documentElement;
  if (!root) return;

  for (const [setting, flag] of Object.entries(FLAGS)) {
    if (values[setting]) root.dataset[flag] = '1';
    else delete root.dataset[flag];
  }
}

try {
  // Синхронно: иначе клиент успеет отрисоваться по-своему.
  values = ipcRenderer.sendSync('kotamusic:settings:sync') || {};
} catch {
  // Канала нет — значит мод в клиенте не запустился, ничего не меняем.
}

apply();
document.addEventListener('DOMContentLoaded', apply);

ipcRenderer.on('kotamusic:settings:changed', (_event, next) => {
  values = next || {};
  apply();
});
