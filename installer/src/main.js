'use strict';
// Установщик KotaMusic.

const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const client = require('./client');
const releases = require('./releases');
const { install, uninstall } = require('./install');

let window = null;
let currentRelease = null;

function create() {
  window = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    title: 'KotaMusic',
    backgroundColor: '#161616',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  window.setMenuBarVisibility(false);
  window.loadFile(path.join(__dirname, 'index.html'));

  // Ссылки открываем в браузере, а не внутри установщика.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('installer:state', async () => {
  const found = client.find();

  try {
    currentRelease = await releases.findRelease(found?.version);
  } catch (e) {
    currentRelease = null;
  }

  return { client: found, release: currentRelease };
});

ipcMain.handle('installer:install', async () => {
  const found = client.find();
  if (!found) return { ok: false, error: 'Яндекс Музыка не найдена' };
  if (!currentRelease) return { ok: false, error: 'Сборка мода недоступна' };

  try {
    const file = await releases.download(currentRelease, (ratio) =>
      window?.webContents.send('installer:progress', ratio)
    );

    await install(found, file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('installer:uninstall', async () => {
  const found = client.find();
  if (!found) return { ok: false, error: 'Яндекс Музыка не найдена' };

  try {
    await uninstall(found);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(create);

app.on('window-all-closed', () => app.quit());
