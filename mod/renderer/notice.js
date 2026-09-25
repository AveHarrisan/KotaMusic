'use strict';
// Короткие сообщения мода в окне клиента.
//
// Нужны там, где мод сам что-то выключил или не смог сделать: журнал
// человек не читает, а тумблер, погасший без объяснений, выглядит
// поломкой.

const { ipcRenderer } = require('electron');

const MARK = 'data-kotamusic-notice';

// Спрашиваем, не ждёт ли нас сообщение: мод мог родить его до того,
// как страница появилась на свет.
const ask = () => ipcRenderer.send('kotamusic:notice:pull');

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ask);
else ask();

ipcRenderer.on('kotamusic:notice', (_event, notice) => {
  if (!notice?.text) return;

  // Второе сообщение подряд заменяет первое, а не громоздится над ним.
  document.querySelector(`[${MARK}]`)?.remove();

  const box = document.createElement('div');
  box.setAttribute(MARK, '1');
  box.style.cssText =
    'position:fixed;right:12px;bottom:48px;z-index:2147483646;max-width:320px;' +
    'padding:12px 14px;border-radius:12px;background:#2a2a2a;color:#fff;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    'opacity:0;transition:opacity .2s;-webkit-app-region:no-drag;cursor:pointer;' +
    `border-left:3px solid ${notice.kind === 'error' ? '#ff8a80' : '#ffdb4d'}`;

  const title = document.createElement('b');
  title.style.cssText = 'display:block;margin-bottom:4px';
  title.textContent = 'KotaMusic';

  const text = document.createElement('div');
  text.textContent = notice.text;

  box.append(title, text);

  const hide = () => {
    box.style.opacity = '0';
    setTimeout(() => box.remove(), 300);
  };

  // Щелчок ведёт туда, где это чинится, а не просто прячет сообщение.
  if (notice.section) {
    box.style.cursor = 'pointer';

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:6px;opacity:.55;font-size:12px';
    hint.textContent = `Открыть настройки → ${notice.section}`;
    box.appendChild(hint);
  }

  box.addEventListener('click', () => {
    if (notice.section) ipcRenderer.send('kotamusic:notice:action', notice.section);
    hide();
  });
  document.body.appendChild(box);
  window.__kotamusicPopup?.(box);
  requestAnimationFrame(() => (box.style.opacity = '1'));

  // Подтверждаем показ: иначе непонятно, дошло ли сообщение до глаз.
  ipcRenderer.send('kotamusic:notice:shown', notice.text);

  // Сообщение о неполадке висит дольше: его надо успеть прочитать.
  setTimeout(hide, notice.kind === 'error' ? 20000 : 8000);
});
