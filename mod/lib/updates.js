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
const upstream = require('./upstream');
const log = require('./log');

const API = `https://api.github.com/repos/${branding.repositoryUrl.split('github.com/')[1]}/releases`;

// Первый раз — когда клиент уже прогрузился, дальше раз в час.
const FIRST_DELAY_MS = 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

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
  const info = mod.assets?.find((a) => a.name === 'build-info.json');

  // Версия самого мода лежит рядом с архивом: релиз на версию клиента
  // один, а мод внутри него обновляется.
  let modVersion = null;

  // Список правок лежит там же: его показываем в сообщении об обновлении,
  // чтобы человек видел, за чем именно он обновляется.
  let notes = [];

  if (info) {
    try {
      const response = await fetch(info.browser_download_url, {
        headers: { 'User-Agent': branding.name },
      });

      if (response.ok) {
        const data = await response.json();
        modVersion = data.modVersion || null;
        if (Array.isArray(data.notes)) notes = data.notes;
      }
    } catch (e) {
      log.debug('Версию мода из релиза прочитать не вышло:', e.message);
    }
  }

  return {
    tag: mod.tag_name,
    clientVersion: mod.tag_name.replace(/^mod-/, ''),
    modVersion,
    notes,
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

  const source = await downloadAsar(update, (share) => onProgress?.(share * (update.clientUrl ? 0.5 : 1)));

  // Клиент обновляем его же официальным установщиком: качаем по адресу,
  // который даёт сам Яндекс, и запускаем перед подменой архива.
  let clientInstaller = '';

  if (update.clientUrl) {
    clientInstaller = await upstream.download(update.clientUrl, (share) =>
      onProgress?.(0.5 + share * 0.5)
    );
  }
  const { asar, integrity, executable } = targets();
  const script = prepareUpdater();

  log.info(`Обновляюсь до ${update.tag}: ${source} → ${asar}`);

  // Установщик клиента закрывает все процессы «Яндекс Музыка.exe», а наш
  // сценарий запущен именно этим файлом — иначе установщик убьёт его
  // вместе с клиентом. Поэтому на Windows порядок ведёт cmd: он ставит
  // клиент, а сценарий подмены зовёт уже после установки.
  if (clientInstaller && process.platform === 'win32') {
    const runner = path.join(path.dirname(script), 'update.cmd');
    const dir = path.dirname(executable);

    fs.writeFileSync(
      runner,
      [
        '@echo off',
        'chcp 65001 >nul',
        'timeout /t 3 /nobreak >nul',
        `"${clientInstaller}" /S /D=${dir}`,
        'timeout /t 5 /nobreak >nul',
        'taskkill /IM "%~nx1" /F >nul 2>&1',
        'timeout /t 3 /nobreak >nul',
        'set ELECTRON_RUN_AS_NODE=1',
        `"${executable}" "${script}" "${source}" "${asar}" "${integrity}" "${executable}" 0 refresh-backup`,
        '',
      ].join('\r\n'),
      'utf8'
    );

    spawn('cmd.exe', ['/c', 'start', '', '/min', runner, path.basename(executable)], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn(
      process.execPath,
      [script, source, asar, integrity, executable, String(process.pid), clientInstaller],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }
    ).unref();
  }

  // Запоминаем, что ждём после перезапуска: по этому файлу новый запуск
  // скажет человеку, получилось ли, и уберёт скачанное.
  try {
    fs.writeFileSync(
      pendingFile(),
      JSON.stringify({
        mod: update.modVersion || null,
        client: update.clientUrl ? update.target || update.clientVersion : null,
        at: Date.now(),
      })
    );
  } catch (e) {
    log.warn('Не удалось записать отметку об обновлении:', e.message);
  }

  // Именно exit: клиент умеет прятаться в область уведомлений, а нам
  // нужно, чтобы он действительно вышел и отпустил свои файлы.
  setTimeout(() => app.exit(0), 500);
}

const pendingFile = () => path.join(app.getPath('userData'), 'kotamusic-pending-update.json');

/** Удаляет файл или папку, не падая, если их уже нет или они заняты. */
function remove(target) {
  try {
    ofs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (e) {
    log.debug('Не удалось удалить', target, e.message);
    return false;
  }
}

/**
 * После перезапуска: сообщаем, встало ли обновление, и убираем за собой
 * скачанные установщик клиента и архивы мода — это сотни мегабайт.
 */
function finishUpdate() {
  let pending = null;
  try {
    pending = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
  } catch {
    return;
  }
  remove(pendingFile());

  const client = app.getVersion?.() || branding.builtForClient;
  const modOk = !pending.mod || pending.mod === branding.version;
  const clientOk = !pending.client || pending.client === client;

  if (modOk && clientOk) {
    const cleaned = [
      path.join(require('os').tmpdir(), 'kotamusic-client'),
      path.join(app.getPath('userData'), 'kotamusic-updates'),
      path.join(process.resourcesPath, 'app.asar.before-update'),
      `${process.execPath}.old`,
    ].filter((target) => ofs.existsSync(target) && remove(target));

    log.info(`Обновление встало: мод ${branding.version}, клиент ${client}; убрано: ${cleaned.length}`);
    require('./notice').show(
      `Обновление установлено: KotaMusic ${branding.version}, Яндекс Музыка ${client}.`,
      { kind: 'info' }
    );
    return;
  }

  // Скачанное не трогаем: пригодится для повторной попытки.
  log.warn(`Обновление не встало: ждали мод ${pending.mod}, клиент ${pending.client}; сейчас ${branding.version}, ${client}`);
  require('./notice').show(
    `Обновление не установилось: сейчас KotaMusic ${branding.version}, Яндекс Музыка ${client}. ` +
      'Попробуйте ещё раз кнопкой со стрелками рядом с версией.'
  );
}

function notify(update, manual = false) {
  const key = `${update.kind}:${update.tag || update.target}`;
  if (announced === key) return;
  announced = key;

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.getTitle?.() === branding.name) continue;
    window.webContents.send('kotamusic:update:available', { ...update, manual });
  }

  log.info(
    update.kind === 'waiting'
      ? `Вышел клиент ${update.target}, сборка мода под него ещё не готова`
      : `Есть обновление (${update.kind}): клиент ${update.clientVersion}`
  );
}

/**
 * Что делать дальше: обновить только мод, обновить клиент вместе с модом
 * или подождать, пока соберётся мод под свежий клиент.
 */
async function plan() {
  const installed = app.getVersion?.() || branding.builtForClient;
  const release = await latest();

  let official = null;
  try {
    official = await upstream.latest();
  } catch (e) {
    log.debug('Версию клиента у Яндекса узнать не вышло:', e.message);
  }

  // Проверка пути «клиент вместе с модом» без ожидания нового клиента:
  // переменная задаётся только при отладке.
  const pretendNewClient = Boolean(process.env.KOTAMUSIC_CLIENT_TEST);

  // Клиент новее нашего: обновляемся вместе, но только когда сборка мода
  // под эту версию уже есть. Иначе ждём автосборку — она идёт раз в час.
  if (official && (pretendNewClient || newer(official.version, installed))) {
    if (release && release.clientVersion === official.version) {
      return { kind: 'client', ...release, installed, clientUrl: official.url, target: official.version };
    }

    return { kind: 'waiting', installed, target: official.version, url: `${branding.repositoryUrl}/releases` };
  }

  // Клиент тот же, а мод обновился: сверяем и версию клиента, под который
  // собран архив, и версию самого мода.
  if (release && newer(release.clientVersion, branding.builtForClient)) {
    return { kind: 'mod', ...release, installed: branding.builtForClient };
  }

  if (release && release.modVersion && newer(release.modVersion, branding.version)) {
    return {
      kind: 'mod',
      ...release,
      installed: branding.version,
      modOnly: true,
    };
  }

  return null;
}

async function check() {
  if (settings.get().updateCheck === false) return;

  try {
    const update = await plan();
    // Про клиент, под который мод ещё не собран, человеку не пишем:
    // клиент и так удерживается на прежней версии, а сообщение появится,
    // когда будет что ставить.
    if (update?.kind === 'waiting') return log.info(`Вышел клиент ${update.target}, жду сборку мода под него`);
    if (update) notify(update);
  } catch (e) {
    log.debug('Проверка обновлений не удалась:', e.message);
  }
}

/** Проверка по кнопке: окно показываем, даже если его уже закрывали. */
async function checkNow() {
  try {
    const update = await plan();
    if (!update || update.kind === 'waiting') return { found: false };

    announced = null;
    notify(update, true);
    return { found: true };
  } catch (e) {
    log.warn('Проверка обновлений по кнопке не удалась:', e.message);
    return { found: false, error: true };
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
    // Наружу пускаем только https, но плашка для трансляции живёт на
    // своём же компьютере по http — её адрес разрешаем отдельно.
    const allowed =
      typeof url === 'string' &&
      (/^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url));

    if (!allowed) return log.warn('Ссылку открывать не стал:', url);

    shell.openExternal(url);
  });

  /** «fetch failed» человеку ничего не говорит — объясняем, что с сетью. */
  const humanError = (e) =>
    e.message === 'fetch failed'
      ? 'нет связи с GitHub' + (e.cause?.code ? ` (${e.cause.code})` : '') +
        '. Проверьте интернет, VPN или прокси и попробуйте ещё раз'
      : e.message;

  // Кнопка «Обновить» в сообщении: качаем архив, подменяем его и
  // перезапускаем клиент — установщик для этого не нужен.
  ipcMain.on('kotamusic:update:apply', async (event, update) => {
    log.info('Запрошено обновление:', update?.tag, update?.asset || 'без файла');

    try {
      await apply(update, (share) =>
        event.sender.send('kotamusic:update:progress', Math.round(share * 100))
      );
    } catch (e) {
      log.warn('Обновление не удалось:', e.message, e.cause?.code || '');
      event.sender.send('kotamusic:update:failed', humanError(e));
    }
  });

  ipcMain.handle('kotamusic:update:check', () => checkNow());

  try {
    finishUpdate();
  } catch (e) {
    log.warn('Проверка итогов обновления не удалась:', e.message);
  }

  setTimeout(check, FIRST_DELAY_MS);
  setInterval(check, INTERVAL_MS);
}

module.exports = { start, check, newer };
