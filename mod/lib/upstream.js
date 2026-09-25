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

const diagnostics = require('./diagnostics');

const META_BASE = 'https://music-desktop-application.s3.yandex.net/stable/';
const CDN_BASE = 'https://desktop.app.music.yandex.net/stable/';

// ⚠️ Адрес установщика берём из того же файла, что и версию: download.json
// у Яндекса отстаёт, и 16.09.2026 вместо 5.120.0 ставился прежний 5.119.0 —
// человек жал «Обновить», а клиент оставался старым.
const SOURCE = {
  win32: { meta: 'latest.yml', file: /\.exe$/ },
  darwin: { meta: 'latest-mac.yml', file: /\.dmg$/ },
  linux: { meta: 'latest-linux.yml', file: /\.deb$/ },
};

/** Текущая версия клиента и адрес установщика именно этой версии. */
async function latest() {
  const source = SOURCE[process.platform];
  if (!source) throw new Error('Для этой системы установщика нет');

  const response = await diagnostics.request(META_BASE + source.meta);

  const text = await response.text();
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const base = /^\s*UPDATE_URL:\s*(\S+)\s*$/m.exec(text)?.[1] || CDN_BASE;
  const file = [...text.matchAll(/^\s*(?:-\s*url|path):\s*(\S+)\s*$/gm)]
    .map((m) => m[1])
    .find((name) => source.file.test(name));

  if (!version || !file) throw new Error(`${source.meta}: нет версии или установщика`);
  if (!file.includes(version)) throw new Error(`Установщик ${file} не от версии ${version}`);

  return { version, url: new URL(file, base.endsWith('/') ? base : `${base}/`).href };
}

/** Качает установщик клиента во временную папку. */
async function download(url, onProgress) {
  const dir = path.join(os.tmpdir(), 'kotamusic-client');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, path.basename(new URL(url).pathname));
  const response = await diagnostics.request(url);

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
