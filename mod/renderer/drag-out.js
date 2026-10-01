'use strict';
// Запрет вытаскивать ссылки и картинки из окна клиента.
//
// Ссылки и картинки браузер разрешает тащить наружу сам. Стоит чуть
// сдвинуть мышь с зажатой кнопкой на исполнителе или треке — и Windows
// кладёт на рабочий стол ярлык с внутренним адресом страницы.
// Свою перестановку треков и плейлистов клиент делает на событиях мыши
// (dnd-kit), а не на встроенном перетаскивании, поэтому глушим его целиком.

const { ipcRenderer } = require('electron');

let blocked = true;

function read(values) {
  blocked = values?.blockDragOut !== false;
}

try {
  read(ipcRenderer.sendSync('kotamusic:settings:sync'));
} catch {
  // Канала нет — мод не запустился; запрет по умолчанию остаётся.
}

ipcRenderer.on('kotamusic:settings:changed', (_event, next) => read(next));

// Перехват при погружении: раньше любых обработчиков страницы.
window.addEventListener(
  'dragstart',
  (event) => {
    if (blocked) event.preventDefault();
  },
  true
);
