'use strict';
// Кнопка вызова мини-плеера в заголовке клиента.
//
// Заголовок у клиента свой (titleBarStyle: hidden), системные кнопки
// нарисованы поверх справа. Свою кнопку ставим слева от них: место
// под окном свободно и по нему обычно тянут окно, поэтому кнопке
// отдельно разрешаем нажатия.

const { ipcRenderer } = require('electron');

const MARK = 'kotamusic-miniplayer-button';

// Высота системной полосы окна: нажатия в неё страница не получает,
// поэтому кнопку ставим сразу под ней.
const CAPTION_HEIGHT = 34;

// Системные кнопки окна занимают правый угол. Отступаем от них, чтобы
// по кнопке мини-плеера нельзя было промахнуться в крестик.
const RIGHT_OFFSET = 150;

let enabled = true;

function build() {
  if (document.querySelector(`[data-${MARK}]`)) return;

  const button = document.createElement('button');
  button.dataset[MARK.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
  button.setAttribute(`data-${MARK}`, '1');
  button.type = 'button';
  button.textContent = '!';
  button.title = 'Мини-плеер';

  button.style.cssText =
    'position:fixed;top:' +
    CAPTION_HEIGHT +
    'px;right:' +
    RIGHT_OFFSET +
    'px;z-index:2147483646;width:34px;height:28px;border-radius:8px;' +
    'display:flex;align-items:center;justify-content:center;' +
    'border:none;background:rgba(255,255,255,.08);cursor:pointer;' +
    'font:700 15px/1 system-ui,sans-serif;color:rgba(255,255,255,.8);' +
    'transition:background .12s,color .12s;-webkit-app-region:no-drag';

  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255,255,255,.18)';
    button.style.color = '#fff';
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = 'rgba(255,255,255,.08)';
    button.style.color = 'rgba(255,255,255,.8)';
  });

  button.addEventListener('click', () => ipcRenderer.send('kotamusic:miniplayer:show'));

  document.body.appendChild(button);

}

/** Короткая подсказка о кнопке — показывается один раз. */
function showHint() {
  const hint = document.createElement('div');
  hint.setAttribute('data-kotamusic-hint', '1');
  hint.style.cssText =
    'position:fixed;top:70px;right:' + RIGHT_OFFSET + 'px;z-index:2147483646;max-width:250px;' +
    'padding:12px 14px;border-radius:12px;background:#2a2a2a;color:#fff;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    'opacity:0;transition:opacity .2s;-webkit-app-region:no-drag';

  hint.innerHTML =
    '<b style="display:block;margin-bottom:4px">KotaMusic</b>' +
    'Кнопка <b>!</b> открывает мини-плеер — маленькое окно поверх остальных. ' +
    'Оно запоминает, куда вы его поставили.';

  document.body.appendChild(hint);
  requestAnimationFrame(() => (hint.style.opacity = '1'));

  const hide = () => {
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 300);
  };

  hint.addEventListener('click', hide);
  setTimeout(hide, 9000);
}

function remove() {
  document.querySelector(`[data-${MARK}]`)?.remove();
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
    // кнопку на место, если она пропала.
    new MutationObserver(() => enabled && build()).observe(document.body, {
      childList: true,
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
