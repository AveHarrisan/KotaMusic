'use strict';
// Сообщение о свежей сборке мода. Показывается один раз за запуск,
// в том же углу, что и подсказка о мини-плеере.

const { ipcRenderer } = require('electron');

ipcRenderer.on('kotamusic:update:available', (_event, update) => {
  const shown = document.querySelector('[data-kotamusic-update]');
  if (shown && !update.manual) return;
  shown?.remove();
  document.querySelector('[data-kotamusic-toast]')?.remove();

  const box = document.createElement('div');
  box.setAttribute('data-kotamusic-update', '1');
  box.style.cssText =
    'position:fixed;right:12px;bottom:48px;z-index:2147483646;max-width:300px;' +
    'padding:12px 14px;border-radius:12px;background:#2a2a2a;color:#fff;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    'opacity:0;transition:opacity .2s;-webkit-app-region:no-drag';

  const message = {
    mod: update.modOnly
      ? `Вышла версия мода ${update.modVersion}, у вас ${update.installed}.`
      : `Вышла сборка мода под клиент ${update.clientVersion}, у вас стоит сборка под ${update.installed}.`,
    client:
      `Вышла Яндекс Музыка ${update.target}, и сборка мода под неё готова. ` +
      'Обновим вместе — мод останется на месте.',
    waiting:
      `Вышла Яндекс Музыка ${update.target}, но сборка мода под неё ещё не готова. ` +
      'Клиент пока держим на прежней версии, чтобы мод не слетел.',
  };

  const text = document.createElement('div');
  text.innerHTML =
    '<b style="display:block;margin-bottom:4px">KotaMusic</b>' +
    (message[update.kind] || message.mod);

  box.appendChild(text);

  // Что изменилось: список приходит из CHANGELOG.md вместе со сборкой.
  // Длинный перечень сворачиваем, иначе сообщение займёт пол-экрана.
  const notes = Array.isArray(update.notes) ? update.notes.filter(Boolean) : [];

  if (notes.length && update.kind !== 'waiting') {
    const list = document.createElement('ul');
    list.style.cssText = 'margin:8px 0 0;padding-left:18px;opacity:.75;line-height:1.35';

    const shown = notes.slice(0, 3);
    shown.forEach((note) => {
      const item = document.createElement('li');
      item.style.marginTop = '3px';
      item.textContent = note;
      list.appendChild(item);
    });

    box.appendChild(list);

    if (notes.length > shown.length) {
      const more = document.createElement('div');
      more.style.cssText = 'margin-top:4px;opacity:.5';
      more.textContent = `и ещё ${notes.length - shown.length} — на странице релиза`;
      box.appendChild(more);
    }
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';

  const button = (label, main) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.style.cssText =
      'padding:6px 10px;border:none;border-radius:8px;cursor:pointer;' +
      'font:600 12px system-ui,sans-serif;' +
      (main
        ? 'background:#ffdb4d;color:#1a1a1a'
        : 'background:rgba(255,255,255,.14);color:#fff');

    row.appendChild(node);
    return node;
  };

  const hide = () => {
    box.style.opacity = '0';
    setTimeout(() => box.remove(), 300);
  };

  // Обновиться можно прямо отсюда: мод скачает архив, подменит его
  // и перезапустит клиент. Установщик для этого не нужен.
  if (update.asset) {
    const now = button(
      update.kind === 'client' ? 'Обновить клиент и мод' : 'Обновить и перезапустить',
      true
    );

    now.addEventListener('click', (event) => {
      event.stopPropagation();
      now.disabled = true;
      now.textContent = 'Скачиваю…';
      text.textContent =
        update.kind === 'client'
          ? 'Скачиваем клиент и мод. Клиент закроется и запустится сам.'
          : 'Клиент перезапустится сам, когда файл будет готов.';
      ipcRenderer.send('kotamusic:update:apply', update);
    });

    ipcRenderer.on('kotamusic:update:progress', (_e, percent) => {
      now.textContent = `Скачиваю… ${percent}%`;
    });

    ipcRenderer.on('kotamusic:update:failed', (_e, message) => {
      now.disabled = false;
      now.textContent = 'Обновить и перезапустить';
      text.textContent = `Не вышло: ${message}.`;
      offerReport();
    });
  }

  // Обновление сорвалось — даём собрать отчёт и сразу завести задачу:
  // по одной строке ошибки причину не найти.
  let report = null;
  const offerReport = () => {
    if (report) return;

    report = button('Собрать логи');
    report.addEventListener('click', async (event) => {
      event.stopPropagation();

      if (report.dataset.issue) {
        ipcRenderer.send('kotamusic:open-url', report.dataset.issue);
        return;
      }

      report.disabled = true;
      report.textContent = 'Собираю… (до 20 с)';

      const result = await ipcRenderer.invoke('kotamusic:diagnostics:collect').catch(() => null);
      report.disabled = false;

      if (!result || result.error) {
        report.textContent = 'Собрать логи';
        text.textContent = `Отчёт не собрался: ${result?.error || 'неизвестная ошибка'}`;
        return;
      }

      report.dataset.issue = result.issueUrl;
      report.textContent = 'Создать задачу на GitHub';
      text.textContent =
        'Отчёт сохранён в «Загрузки», папка открыта. Создайте задачу и перетащите в неё этот файл.';
    });
  };

  const open = button('Страница релиза');

  open.addEventListener('click', (event) => {
    event.stopPropagation();
    ipcRenderer.send('kotamusic:open-url', update.url);
    hide();
  });

  box.appendChild(row);
  document.body.appendChild(box);
  window.__kotamusicPopup?.(box);
  requestAnimationFrame(() => (box.style.opacity = '1'));

  box.addEventListener('click', hide);
});
