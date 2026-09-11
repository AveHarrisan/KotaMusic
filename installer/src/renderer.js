'use strict';
// Окно установщика: показывает найденный клиент и предлагает два действия.

const { ipcRenderer } = require('electron');

const el = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  el('status').textContent = text;
  el('status').className = kind;
}

function render(state) {
  el('client').textContent = state.client?.dir || 'не найден';
  el('version').textContent = state.client?.version || '—';
  el('mod').textContent = state.release
    ? `${state.release.clientVersion}${state.release.exact ? '' : ' (под другую версию)'}`
    : '—';
  el('state').textContent = state.client?.installed ? 'установлен' : 'не установлен';

  // Видно, какой именно файл заменяем: вопрос «куда оно ставится»
  // возникает первым.
  el('target').textContent = state.client?.asar || '—';
  el('target').title = state.client?.asar || '';

  el('install').disabled = !state.client || !state.release;
  el('uninstall').disabled = !state.client?.installed || !state.client?.hasBackup;

  // Клиента нет — предлагаем поставить его с сайта Яндекса, и тогда
  // главная кнопка окна именно эта.
  // Пока клиента нет — ставим его с выбором папки. Когда он уже стоит,
  // установщик Яндекса папку не спрашивает, поэтому для переезда
  // предлагаем сначала удалить клиент.
  el('install-client').hidden = Boolean(state.client);
  el('uninstall-client').hidden = !state.client;
  el('pick').hidden = Boolean(state.client);

  // Сборку мода не видно — даём повторить попытку, не перезапуская окно.
  el('retry').hidden = Boolean(state.release);
  el('install').classList.toggle('secondary', !state.client);

  if (!state.client) {
    setStatus('Яндекс Музыка не найдена. Установите её — адрес свежей версии берём у Яндекса.');
  }

  if (state.client && state.release && state.release.exact && !state.client.installed) {
    setStatus(`Готово к установке: мод под клиент ${state.release.clientVersion} → ${state.client.asar}`);
  }

  if (state.client && state.release && !state.release.exact) {
    setStatus(
      `Мод собран под клиент ${state.release.clientVersion}, а у вас ${state.client.version}. ` +
        `Обновите клиент или дождитесь новой сборки.`,
      'error'
    );
  }
}

el('install').addEventListener('click', async () => {
  el('install').disabled = true;
  el('uninstall').disabled = true;
  setStatus('Скачиваем мод…');
  el('progress').hidden = false;

  const result = await ipcRenderer.invoke('installer:install');
  el('progress').hidden = true;

  if (result.ok) setStatus('Готово. Запустите Яндекс Музыку.', 'done');
  else setStatus(result.error, 'error');

  render(await ipcRenderer.invoke('installer:state'));
});

el('install-client').addEventListener('click', async () => {
  el('install-client').disabled = true;
  setStatus('Качаем и ставим Яндекс Музыку…');
  el('progress').hidden = false;

  const result = await ipcRenderer.invoke('installer:install-client');
  el('progress').hidden = true;
  el('install-client').disabled = false;

  if (!result.ok && !result.error) {
    setStatus('Установка отменена.');
    return;
  }

  if (result.ok && result.dir) {
    setStatus(`Яндекс Музыка ${result.version} установлена в ${result.dir}.`, 'done');
  } else if (result.ok) {
    setStatus(
      `Запустили установщик Яндекс Музыки ${result.version}. ` +
        'Пройдите установку и нажмите «Установить мод».',
      'done'
    );
  } else {
    setStatus(result.error, 'error');
  }

  render(await ipcRenderer.invoke('installer:state'));
});

el('retry').addEventListener('click', async () => {
  setStatus('Проверяем…');
  render(await ipcRenderer.invoke('installer:state'));
});

el('uninstall-client').addEventListener('click', async () => {
  el('uninstall-client').disabled = true;
  setStatus('Удаляем Яндекс Музыку…');

  const result = await ipcRenderer.invoke('installer:uninstall-client');
  el('uninstall-client').disabled = false;

  if (result.ok) {
    setStatus('Яндекс Музыка удалена. Теперь можно поставить её в другую папку.', 'done');
  } else if (result.error) {
    setStatus(result.error, 'error');
  } else {
    setStatus('Удаление отменено.');
  }

  const state = await ipcRenderer.invoke('installer:state');
  render(state);
  if (!state.client) watchForClient();
});

el('pick').addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('installer:pick-folder');

  if (result.ok) setStatus(`Клиент найден: ${result.dir}`, 'done');
  else if (result.error) setStatus(result.error, 'error');

  render(await ipcRenderer.invoke('installer:state'));
});

el('uninstall').addEventListener('click', async () => {
  el('uninstall').disabled = true;
  setStatus('Возвращаем оригинал…');

  const result = await ipcRenderer.invoke('installer:uninstall');
  if (result.ok) setStatus('Мод удалён, клиент восстановлен.', 'done');
  else setStatus(result.error, 'error');

  render(await ipcRenderer.invoke('installer:state'));
});

ipcRenderer.on('installer:progress', (_event, ratio) => {
  el('progress').value = ratio;
  el('progress').max = 1;
});

/**
 * Пока клиента нет, поглядываем сами: человек ставит его прямо сейчас,
 * и окно должно это заметить без перезапуска.
 */
function watchForClient() {
  const timer = setInterval(async () => {
    const state = await ipcRenderer.invoke('installer:state');
    if (!state.client) return;

    clearInterval(timer);
    render(state);
    setStatus('Яндекс Музыка найдена. Можно ставить мод.', 'done');
  }, 3000);
}

(async () => {
  const state = await ipcRenderer.invoke('installer:state');
  render(state);

  if (!state.client) watchForClient();

  if (!state.release && state.client) {
    setStatus(
      'Список сборок мода недоступен — GitHub не ответил. Проверьте сеть ' +
        'и нажмите «Проверить снова».',
      'error'
    );
  }
})();
