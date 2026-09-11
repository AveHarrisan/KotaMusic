'use strict';
// Установщик KotaMusic.

const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const client = require('./client');
const releases = require('./releases');
const upstream = require('./upstream');
const { install, uninstall } = require('./install');

let window = null;
let currentRelease = null;

function create() {
  window = new BrowserWindow({
    width: 520,
    height: 470,
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

/** Что показывать в окне: найденный клиент и подходящая сборка мода. */
async function readState() {
  const found = client.find();

  try {
    currentRelease = await releases.findRelease(found?.version);
  } catch {
    currentRelease = null;
  }

  return { client: found, release: currentRelease };
}

async function doInstall() {
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
}

async function doUninstall() {
  const found = client.find();
  if (!found) return { ok: false, error: 'Яндекс Музыка не найдена' };

  try {
    await uninstall(found);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Клиента нет — качаем официальный установщик Яндекс Музыки и запускаем
 * его. Сам мод ставится уже потом, поверх установленного клиента.
 */
async function doInstallClient() {
  try {
    const { version, url } = await upstream.latest();

    const file = await upstream.download(url, (ratio) =>
      window?.webContents.send('installer:progress', ratio)
    );

    // Дальше человек проходит установку клиента сам: это чужой установщик,
    // молча за него отвечать мы не вправе.
    const error = await shell.openPath(file);
    if (error) throw new Error(error);

    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('installer:state', readState);
ipcMain.handle('installer:install-client', doInstallClient);
ipcMain.handle('installer:install', doInstall);
ipcMain.handle('installer:uninstall', doUninstall);

/** Самопроверка: прогоняет то же, что делают кнопки окна. */
async function selfTest() {
  const state = await readState();
  console.log('состояние:', JSON.stringify({
    клиент: state.client?.dir,
    версия: state.client?.version,
    сборка: state.release?.clientVersion,
    совпадает: state.release?.exact,
    установлен: state.client?.installed,
  }, null, 0));

  console.log('установка:', JSON.stringify(await doInstall()));
  console.log('после установки:', (await readState()).client?.installed);

  console.log('удаление:', JSON.stringify(await doUninstall()));
  console.log('после удаления:', (await readState()).client?.installed);

  app.quit();
}

app.whenReady().then(() => {
  if (process.env.KOTAMUSIC_SELFTEST) return selfTest();
  create();
});

app.on('window-all-closed', () => app.quit());
