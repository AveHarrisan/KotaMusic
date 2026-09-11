'use strict';
// Установщик KotaMusic.

const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const client = require('./client');
const releases = require('./releases');
const upstream = require('./upstream');
const { install, uninstall } = require('./install');

let window = null;
let currentRelease = null;

function create() {
  window = new BrowserWindow({
    width: 520,
    height: 620,
    minHeight: 480,
    resizable: true,
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
/** Куда ставим клиент, если его ещё нет. */
function defaultClientDir() {
  const local = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');
  return path.join(local, 'Programs', 'YandexMusic');
}

async function doInstallClient() {
  try {
    const { version, url } = await upstream.latest();

    // Ставим в обычное место и без вопросов: установщик Яндекса иначе
    // подставит папку прошлой установки, а она бывает где угодно.
    // Кому нужна своя папка — есть «Указать папку с клиентом».
    const dir = process.platform === 'win32' ? defaultClientDir() : null;

    const file = await upstream.download(url, (ratio) =>
      window?.webContents.send('installer:progress', ratio)
    );

    // Ставим сами в выбранную папку: так человек видит, куда всё легло,
    // и клиент потом точно находится.
    if (dir) {
      await new Promise((done, fail) => {
        const child = spawn(file, ['/S', `/D=${dir}`], { stdio: 'ignore' });
        child.on('exit', () => done());
        child.on('error', fail);
      });

      client.remember(dir);
      return { ok: true, version, dir };
    }

    // На других системах установку проходит человек: там у пакета
    // свои правила, и лезть за него мы не вправе.
    const error = await shell.openPath(file);
    if (error) throw new Error(error);

    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Ручной выбор папки клиента: установка бывает где угодно. */
async function pickFolder() {
  const result = await dialog.showOpenDialog(window, {
    title: 'Где стоит Яндекс Музыка',
    properties: ['openDirectory'],
    buttonLabel: 'Выбрать',
  });

  if (result.canceled || !result.filePaths.length) return { ok: false };

  const dir = result.filePaths[0];
  client.remember(dir);

  const found = client.find();
  if (!found) return { ok: false, error: 'В этой папке нет Яндекс Музыки' };

  return { ok: true, dir: found.dir };
}

/**
 * Удаление клиента: пока он стоит, установщик Яндекса не спрашивает папку,
 * поэтому сменить место можно только через удаление и установку заново.
 */
async function doUninstallClient() {
  const found = client.find();
  if (!found) return { ok: false, error: 'Яндекс Музыка не найдена' };

  if (client.isRunning(found)) {
    return { ok: false, error: 'Яндекс Музыка запущена — закройте её и повторите' };
  }

  if (!found.uninstaller) {
    return { ok: false, error: 'Рядом с клиентом нет программы удаления' };
  }

  const answer = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['Удалить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'Удалить Яндекс Музыку',
    message: `Удалить Яндекс Музыку из ${found.dir}?`,
    detail:
      'Мод удалится вместе с клиентом. После удаления можно поставить ' +
      'клиент заново и выбрать другую папку.',
  });

  if (answer.response !== 0) return { ok: false };

  try {
    await new Promise((done, fail) => {
      const child = spawn(found.uninstaller, ['/S', '/currentuser'], { stdio: 'ignore' });
      child.on('exit', () => done());
      child.on('error', fail);
    });

    // Программа удаления работает не мгновенно — ждём, пока папка исчезнет.
    for (let i = 0; i < 20 && client.find(); i += 1) {
      await new Promise((done) => setTimeout(done, 500));
    }

    client.remember('');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('installer:state', readState);
ipcMain.handle('installer:uninstall-client', doUninstallClient);
ipcMain.handle('installer:pick-folder', pickFolder);
ipcMain.handle('installer:install-client', doInstallClient);
ipcMain.handle('installer:install', doInstall);
ipcMain.handle('installer:uninstall', doUninstall);

/**
 * Самопроверка: прогоняет то же, что делают кнопки окна.
 * KOTAMUSIC_SELFTEST=install — только установка, uninstall — только
 * удаление, любое другое значение — полный круг.
 */
async function selfTest() {
  const only = process.env.KOTAMUSIC_SELFTEST;
  const state = await readState();
  console.log('состояние:', JSON.stringify({
    клиент: state.client?.dir,
    версия: state.client?.version,
    сборка: state.release?.clientVersion,
    совпадает: state.release?.exact,
    установлен: state.client?.installed,
  }, null, 0));

  if (only !== 'uninstall') {
    console.log('установка:', JSON.stringify(await doInstall()));
    console.log('после установки:', (await readState()).client?.installed);
  }

  if (only !== 'install') {
    console.log('удаление:', JSON.stringify(await doUninstall()));
    console.log('после удаления:', (await readState()).client?.installed);
  }

  app.quit();
}

app.whenReady().then(() => {
  if (process.env.KOTAMUSIC_SELFTEST) return selfTest();
  create();
});

app.on('window-all-closed', () => app.quit());
