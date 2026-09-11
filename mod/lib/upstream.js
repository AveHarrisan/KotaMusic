'use strict';
// Официальная раздача клиента Яндекс Музыки.
//
// Ничего чужого мы не храним и не раздаём: адрес свежего установщика
// берём у самого Яндекса, качаем оттуда и запускаем его же установщик.

const os = require('os');
const path = require('path');

// Electron выдаёт пути с «.asar» за папку, но установщик клиента — обычный
// файл, поэтому хватает и штатного модуля.
const fs = require('fs');

const META_URL = 'https://music-desktop-application.s3.yandex.net/stable/latest.yml';
const DOWNLOAD_URL = 'https://music-desktop-application.s3.yandex.net/stable/download.json';

const KEY = { win32: 'windows', darwin: 'macos', linux: 'linux' };

/** Текущая версия клиента и адрес установщика под эту систему. */
async function latest() {
  const [meta, downloads] = await Promise.all([fetch(META_URL), fetch(DOWNLOAD_URL)]);

  if (!meta.ok) throw new Error(`latest.yml: HTTP ${meta.status}`);
  if (!downloads.ok) throw new Error(`download.json: HTTP ${downloads.status}`);

  const version = /^version:\s*(.+)$/m.exec(await meta.text())?.[1]?.trim();
  const urls = await downloads.json();
  const url = urls[KEY[process.platform]];

  if (!url) throw new Error('Для этой системы установщика нет');

  return { version, url };
}

/** Качает установщик клиента во временную папку. */
async function download(url, onProgress) {
  const dir = path.join(os.tmpdir(), 'kotamusic-client');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, path.basename(new URL(url).pathname));
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Скачивание не удалось: ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;

  for await (const chunk of response.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (total) onProgress?.(received / total);
  }

  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

module.exports = { latest, download };
