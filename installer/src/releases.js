'use strict';
// Загрузка мода из релизов GitHub и его хранение.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('electron');

const REPO = 'AveHarrisan/KotaMusic';
const API = `https://api.github.com/repos/${REPO}/releases`;

const cacheDir = () => path.join(app.getPath('userData'), 'cache');

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

/** Релиз мода под указанную версию клиента, иначе — самый свежий. */
async function findRelease(clientVersion) {
  const local = localRelease(clientVersion);
  if (local) return local;

  const response = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KotaMusic' },
  });
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);

  const releases = (await response.json()).filter((r) => !r.draft);
  if (!releases.length) throw new Error('Релизов пока нет');

  const exact = releases.find((r) => r.tag_name === `mod-${clientVersion}`);
  const chosen = exact || releases[0];

  const asset = chosen.assets.find((a) => a.name === 'app.asar');
  if (!asset) throw new Error(`В релизе ${chosen.tag_name} нет файла мода`);

  return {
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
