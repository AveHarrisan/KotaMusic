'use strict';
// Проверка обновлений мода.
//
// Мод собирается под конкретную версию клиента: тег релиза выглядит как
// mod-5.119.0. Клиент обновляется сам, и после обновления наш app.asar
// остаётся от прошлой версии — об этом и надо сказать человеку, а не
// ждать, пока он случайно узнает.

const fs = require('fs');

// Electron выдаёт любой путь с «.asar» за папку, поэтому сам архив
// читаем и пишем в обход его подмены. Файлы внутри архива — наоборот,
// только обычным fs: он про архив знает.
const ofs = (() => {
  try {
    return require('original-fs');
  } catch {
    return require('fs');
  }
})();
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const branding = require('../branding');
const settings = require('./settings');
const log = require('./log');

const API = `https://api.github.com/repos/${branding.repositoryUrl.split('github.com/')[1]}/releases`;

// Первый раз — когда клиент уже прогрузился, дальше раз в шесть часов.
const FIRST_DELAY_MS = 60 * 1000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let announced = null;

/** Сравнение версий вида 5.119.0. */
function newer(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x !== y) return x > y;
  }

  return false;
}

/** Самый свежий релиз мода: тег и версия клиента, под которую он собран. */
async function latest() {
  const response = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': branding.name },
  });

  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);

  const releases = (await response.json()).filter((r) => !r.draft && !r.prerelease);
  const mod = releases.find((r) => /^mod-/.test(r.tag_name));
  if (!mod) return null;

  const asset = mod.assets?.find((a) => a.name === 'app.asar');

  return {
    tag: mod.tag_name,
    clientVersion: mod.tag_name.replace(/^mod-/, ''),
    url: mod.html_url,
    // Ссылка на сам архив — по ней мод обновляет себя без установщика.
    asset: asset?.browser_download_url || null,
    size: asset?.size || 0,
  };
}

/** Куда мод установлен и что нужно поправить при подмене архива. */
function targets() {
  const asar = path.join(process.resourcesPath, 'app.asar');

  const integrity =
    process.platform === 'darwin'
      ? path.join(process.resourcesPath, '..', 'Info.plist')
      : process.execPath;

  return { asar, integrity, executable: process.execPath };
}

/** Качает архив с GitHub, сообщая о ходе загрузки. */
async function downloadAsar(update, onProgress) {
  const dir = path.join(app.getPath('userData'), 'kotamusic-updates');
  ofs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `app-${update.tag}.asar`);

  if (ofs.existsSync(file) && update.size && ofs.statSync(file).size === update.size) {
    return file;
  }

  const response = await fetch(update.asset, { headers: { 'User-Agent': branding.name } });
  if (!response.ok) throw new Error(`Скачивание не удалось: ${response.status}`);

  const total = Number(response.headers.get('content-length')) || update.size;
  const chunks = [];
  let received = 0;

  for await (const chunk of response.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (total) onProgress?.(received / total);
  }

  ofs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

/**
 * Кладёт сценарий подмены рядом с настройками: он должен пережить замену
 * самого архива, из которого запущен мод.
 */
function prepareUpdater() {
  const from = path.join(__dirname, '..', 'updater');
  const to = path.join(app.getPath('userData'), 'kotamusic-updater');

  fs.mkdirSync(to, { recursive: true });

  for (const name of fs.readdirSync(from)) {
    fs.writeFileSync(path.join(to, name), fs.readFileSync(path.join(from, name)));
  }

  return path.join(to, 'apply.js');
}

/**
 * Скачивает новую сборку и просит клиента закрыться: подменить занятый
 * архив нельзя, поэтому замену и обратный запуск делает отдельный процесс.
 */
async function apply(update, onProgress) {
  if (!update.asset) throw new Error('В релизе нет файла мода');

  const source = await downloadAsar(update, onProgress);
  const { asar, integrity, executable } = targets();
  const script = prepareUpdater();

  log.info(`Обновляюсь до ${update.tag}: ${source} → ${asar}`);

  spawn(
    process.execPath,
    [script, source, asar, integrity, executable, String(process.pid)],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }
  ).unref();

  // Именно exit: клиент умеет прятаться в область уведомлений, а нам
  // нужно, чтобы он действительно вышел и отпустил свои файлы.
  setTimeout(() => app.exit(0), 500);
}

function notify(update) {
  if (announced === update.tag) return;
  announced = update.tag;

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.getTitle?.() === branding.name) continue;
    window.webContents.send('kotamusic:update:available', update);
  }

  log.info(`Вышла сборка мода под клиент ${update.clientVersion}`);
}

async function check() {
  if (settings.get().updateCheck === false) return;

  try {
    const update = await latest();
    if (!update) return;

    const client = app.getVersion?.() || branding.builtForClient;

    // Сообщаем, когда есть сборка под клиент новее того, из которого
    // собран наш архив. Свежесть самого клиента тут ни при чём: мод
    // может стоять и на старом.
    if (!newer(update.clientVersion, branding.builtForClient)) return;

    notify({ ...update, client, installed: branding.builtForClient });
  } catch (e) {
    log.debug('Проверка обновлений не удалась:', e.message);
  }
}

function start() {
  // Проверка сообщения без ожидания настоящего релиза: переменная задаётся
  // только при отладке, в обычной работе её нет.
  if (process.env.KOTAMUSIC_UPDATE_TEST) {
    setTimeout(
      () =>
        notify({
          tag: `mod-${process.env.KOTAMUSIC_UPDATE_TEST}`,
          clientVersion: process.env.KOTAMUSIC_UPDATE_TEST,
          url: `${branding.repositoryUrl}/releases`,
          asset: process.env.KOTAMUSIC_UPDATE_ASSET || null,
          size: 0,
          installed: branding.builtForClient,
        }),
      15000
    );
  }

  ipcMain.on('kotamusic:open-url', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });

  // Кнопка «Обновить» в сообщении: качаем архив, подменяем его и
  // перезапускаем клиент — установщик для этого не нужен.
  ipcMain.on('kotamusic:update:apply', async (event, update) => {
    log.info('Запрошено обновление:', update?.tag, update?.asset || 'без файла');

    try {
      await apply(update, (share) =>
        event.sender.send('kotamusic:update:progress', Math.round(share * 100))
      );
    } catch (e) {
      log.warn('Обновление не удалось:', e.message);
      event.sender.send('kotamusic:update:failed', e.message);
    }
  });

  setTimeout(check, FIRST_DELAY_MS);
  setInterval(check, INTERVAL_MS);
}

module.exports = { start, check, newer };
