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

  el('install').disabled = !state.client || !state.release;
  el('uninstall').disabled = !state.client?.installed || !state.client?.hasBackup;

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

(async () => {
  const state = await ipcRenderer.invoke('installer:state');
  render(state);

  if (!state.client) setStatus('Яндекс Музыка не найдена. Установите её и откройте меня снова.', 'error');
  else if (!state.release) setStatus('Не удалось получить список сборок мода.', 'error');
})();
