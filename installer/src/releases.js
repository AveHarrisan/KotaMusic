'use strict';
// Загрузка мода из релизов GitHub и его хранение.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const REPO = 'AveHarrisan/KotaMusic';

// Адрес можно подменить при проверках: так видно, что мод умеет обойтись
// без списка релизов.
const API = process.env.KOTAMUSIC_API || `https://api.github.com/repos/${REPO}/releases`;

// Electron подключаем внутри: без него модуль остаётся пригодным для
// быстрой проверки обычным Node.
const cacheDir = () => path.join(require('electron').app.getPath('userData'), 'cache');

/**
 * Локальная сборка вместо релиза — для проверки установщика до того,
 * как репозиторий опубликован.
 */
function localRelease(clientVersion) {
  const file = process.env.KOTAMUSIC_LOCAL_ASAR;
  if (!file || !fs.existsSync(file)) return null;

  let version = clientVersion;
  try {
    const info = path.join(path.dirname(file), 'build-info.json');
    version = JSON.parse(fs.readFileSync(info, 'utf8')).clientVersion;
  } catch {}

  return {
    tag: `local-${version}`,
    name: 'Локальная сборка',
    notes: '',
    url: file,
    size: fs.statSync(file).size,
    clientVersion: version,
    exact: version === clientVersion,
    local: true,
  };
}

/**
 * Запасной путь, когда список релизов недоступен: у API GitHub есть
 * предел обращений с одного адреса, а имя файла в релизе постоянное —
 * значит сборку под нужный клиент можно взять напрямую.
 */
async function directRelease(clientVersion) {
  if (!clientVersion) return null;

  const tag = `mod-${clientVersion}`;
  const url = `https://github.com/${REPO}/releases/download/${tag}/app.asar`;

  try {
    const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'KotaMusic' } });
    if (!head.ok) return null;

    // Номер версии мода лежит рядом, по такой же постоянной ссылке.
    let modVersion = null;
    try {
      const info = await fetch(
        `https://github.com/${REPO}/releases/download/${tag}/build-info.json`,
        { headers: { 'User-Agent': 'KotaMusic' } }
      );
      if (info.ok) modVersion = (await info.json()).modVersion || null;
    } catch {}

    return {
      tag,
      name: `KotaMusic для Яндекс Музыки ${clientVersion}`,
      notes: '',
      url,
      size: Number(head.headers.get('content-length')) || 0,
      clientVersion,
      modVersion,
      exact: true,
    };
  } catch {
    return null;
  }
}

/**
 * Версия самого мода в релизе: релиз на версию клиента один, а мод
 * внутри него обновляется, поэтому номер лежит рядом с архивом.
 */
async function modVersionOf(release) {
  const info = release.assets?.find((a) => a.name === 'build-info.json');
  if (!info) return null;

  try {
    const response = await fetch(info.browser_download_url, {
      headers: { 'User-Agent': 'KotaMusic' },
    });

    if (!response.ok) return null;
    return (await response.json()).modVersion || null;
  } catch {
    return null;
  }
}

/** Релиз мода под указанную версию клиента, иначе — самый свежий. */
async function findRelease(clientVersion) {
  const local = localRelease(clientVersion);
  if (local) return local;

  let response;

  try {
    response = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KotaMusic' },
    });
  } catch (e) {
    const direct = await directRelease(clientVersion);
    if (direct) return direct;
    throw e;
  }

  if (!response.ok) {
    const direct = await directRelease(clientVersion);
    if (direct) return direct;
    throw new Error(`GitHub ответил ${response.status}`);
  }

  const releases = (await response.json()).filter((r) => !r.draft);

  if (!releases.length) {
    const direct = await directRelease(clientVersion);
    if (direct) return direct;
    throw new Error('Релизов пока нет');
  }

  // Релиз установщика лежит рядом с релизами мода — берём только моды.
  const mods = releases.filter((r) => /^mod-/.test(r.tag_name));
  const exact = mods.find((r) => r.tag_name === `mod-${clientVersion}`);
  const chosen = exact || mods[0];

  if (!chosen) {
    const direct = await directRelease(clientVersion);
    if (direct) return direct;
    throw new Error('Сборок мода пока нет');
  }

  const asset = chosen.assets.find((a) => a.name === 'app.asar');
  if (!asset) throw new Error(`В релизе ${chosen.tag_name} нет файла мода`);

  return {
    modVersion: await modVersionOf(chosen),
    tag: chosen.tag_name,
    name: chosen.name,
    notes: chosen.body,
    url: asset.browser_download_url,
    size: asset.size,
    // Мод собирается под конкретную версию клиента — это важно показать.
    clientVersion: chosen.tag_name.replace(/^mod-/, ''),
    exact: Boolean(exact),
  };
}

/** Качает файл мода, сообщая о ходе загрузки. */
async function download(release, onProgress) {
  if (release.local) {
    onProgress?.(1);
    return release.url;
  }

  await fsp.mkdir(cacheDir(), { recursive: true });
  const target = path.join(cacheDir(), `app-${release.tag}.asar`);

  if (fs.existsSync(target) && fs.statSync(target).size === release.size) {
    return target; // уже скачан
  }

  const response = await fetch(release.url, { headers: { 'User-Agent': 'KotaMusic' } });
  if (!response.ok) throw new Error(`Скачивание не удалось: ${response.status}`);

  const total = Number(response.headers.get('content-length')) || release.size;
  const chunks = [];
  let received = 0;

  for await (const chunk of response.body) {
    chunks.push(chunk);
    received += chunk.length;
    onProgress?.(total ? received / total : 0);
  }

  await fsp.writeFile(target, Buffer.concat(chunks));
  return target;
}

module.exports = { findRelease, download, REPO };
