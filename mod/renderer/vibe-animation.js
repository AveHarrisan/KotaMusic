'use strict';
// Переключатель живой анимации Моей Волны.
//
// Ставим признак на корневой элемент страницы: врезка в код клиента
// читает именно его. Настройку берём синхронно — иначе клиент успеет
// отрисовать анимацию до того, как мы ответим.

const { ipcRenderer } = require('electron');

let enabled = false;

function apply() {
  const root = document.documentElement;
  if (!root) return;

  if (enabled) root.dataset.kmLiteVibe = '1';
  else delete root.dataset.kmLiteVibe;
}

try {
  enabled = Boolean(ipcRenderer.sendSync('kotamusic:settings:sync')?.liteVibeAnimation);
} catch {
  // Канала нет — значит мод в клиенте не запустился; анимацию не трогаем.
}

apply();
document.addEventListener('DOMContentLoaded', apply);

// Настройку меняют в том же окне: переключатель должен работать сразу,
// а не после перезапуска клиента.
ipcRenderer.on('kotamusic:settings:changed', (_event, values) => {
  enabled = Boolean(values?.liteVibeAnimation);
  apply();
});
