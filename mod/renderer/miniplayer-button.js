'use strict';
// Кнопка вызова мини-плеера.
//
// Полосу заголовка на Windows рисует система, нажатия по ней страница
// не получает, поэтому кнопку ставим в углу страницы — слева от плашки
// с версией клиента.

const { ipcRenderer } = require('electron');

const MARK = 'kotamusic-miniplayer-button';
const VERSION = /^\d+\.\d+\.\d+$/;

// Отступ от плашки версии.
const GAP = 8;

let enabled = true;
let button = null;

/** Плашка с версией клиента в правом нижнем углу. */
function versionBadge() {
  for (const node of document.body.querySelectorAll('div, span, p')) {
    if (node.children.length) continue;
    if (VERSION.test(node.textContent.trim())) return node;
  }

  return null;
}

/** Держим кнопку слева от плашки; если плашки нет — просто в углу. */
function place() {
  if (!button) return;

  const badge = versionBadge();

  if (!badge) {
    button.style.right = '12px';
    button.style.bottom = '12px';
    return;
  }

  const rect = badge.getBoundingClientRect();
  button.style.right = `${Math.round(window.innerWidth - rect.left + GAP)}px`;
  button.style.bottom = `${Math.round(window.innerHeight - rect.bottom)}px`;
  button.style.height = `${Math.round(rect.height)}px`;
}

function build() {
  if (document.querySelector(`[data-${MARK}]`)) return;

  button = document.createElement('button');
  button.setAttribute(`data-${MARK}`, '1');
  button.type = 'button';
  button.textContent = '!';
  button.title = 'Мини-плеер';

  button.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483646;' +
    'min-width:26px;height:22px;padding:0 6px;border-radius:6px;' +
    'display:flex;align-items:center;justify-content:center;' +
    'border:none;background:rgba(255,255,255,.1);cursor:pointer;' +
    'font:700 13px/1 system-ui,sans-serif;color:rgba(255,255,255,.75);' +
    'transition:background .12s,color .12s;-webkit-app-region:no-drag';

  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255,255,255,.22)';
    button.style.color = '#fff';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = 'rgba(255,255,255,.1)';
    button.style.color = 'rgba(255,255,255,.75)';
  });

  button.addEventListener('click', () => ipcRenderer.send('kotamusic:miniplayer:show'));

  document.body.appendChild(button);
  place();
}

/** Короткая подсказка о кнопке — показывается один раз. */
function showHint() {
  const hint = document.createElement('div');
  hint.setAttribute('data-kotamusic-hint', '1');
  hint.style.cssText =
    'position:fixed;right:12px;bottom:48px;z-index:2147483646;max-width:250px;' +
    'padding:12px 14px;border-radius:12px;background:#2a2a2a;color:#fff;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    'opacity:0;transition:opacity .2s;-webkit-app-region:no-drag';

  hint.innerHTML =
    '<b style="display:block;margin-bottom:4px">KotaMusic</b>' +
    'Кнопка <b>!</b> рядом с версией открывает мини-плеер — маленькое окно ' +
    'поверх остальных. Оно запоминает, куда вы его поставили.';

  document.body.appendChild(hint);
  requestAnimationFrame(() => (hint.style.opacity = '1'));

  const hide = () => {
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 300);
  };

  hint.addEventListener('click', hide);
  setTimeout(hide, 9000);
}

function start() {
  ipcRenderer.invoke('kotamusic:settings:get').then((state) => {
    enabled = state?.values?.miniplayerButton !== false;
    if (!enabled) return;

    build();

    // Подсказку показываем один раз: дальше она только мешала бы.
    if (!state.values.hintShown) {
      setTimeout(showHint, 2500);
      ipcRenderer.invoke('kotamusic:settings:set', { hintShown: true });
    }

    // Клиент перерисовывает страницу целиком при переходах — возвращаем
    // кнопку на место и заново примеряемся к плашке версии.
    new MutationObserver(() => {
      if (!enabled) return;
      build();
      place();
    }).observe(document.body, { childList: true, subtree: true });

    window.addEventListener('resize', place);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
