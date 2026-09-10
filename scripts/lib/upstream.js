'use strict';
// Работа с официальной раздачей клиента Яндекс Музыки.
// Ничего чужого мы не храним: всё качается с их CDN на время сборки.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

const META_URL = 'https://music-desktop-application.s3.yandex.net/stable/latest.yml';
const DOWNLOAD_URL = 'https://music-desktop-application.s3.yandex.net/stable/download.json';

/** Текущая версия клиента и адреса установщиков. */
async function getLatest() {
  const [ymlRes, jsonRes] = await Promise.all([fetch(META_URL), fetch(DOWNLOAD_URL)]);
  if (!ymlRes.ok) throw new Error(`latest.yml: HTTP ${ymlRes.status}`);
  if (!jsonRes.ok) throw new Error(`download.json: HTTP ${jsonRes.status}`);

  const yml = await ymlRes.text();
  const version = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim();
  if (!version) throw new Error('Не удалось прочитать версию из latest.yml');

  return { version, downloads: await jsonRes.json() };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Скачивание ${url}: HTTP ${res.status}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** Достаёт app.asar из установщика. Каждая платформа пакуется по-своему. */
async function extractAsar(installerPath, platform, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const asarPath = path.join(outDir, 'app.asar');

  if (platform === 'linux') {
    execFileSync('ar', ['x', installerPath], { cwd: outDir });
    const data = fs.readdirSync(outDir).find((f) => f.startsWith('data.tar'));
    execFileSync('tar', ['xf', data, '--wildcards', '*/resources/app.asar'], { cwd: outDir });
    const found = findFile(outDir, 'app.asar');
    if (!found) throw new Error('app.asar не найден в .deb');
    if (found !== asarPath) await fsp.rename(found, asarPath);
    return asarPath;
  }

  // .exe (NSIS) и .dmg распаковываются 7-zip
  execFileSync('7z', ['x', '-y', `-o${outDir}`, installerPath], { stdio: 'ignore' });

  // NSIS прячет само приложение во вложенный архив ($PLUGINSDIR/app-64.7z),
  // а .dmg — в образ файловой системы. Разбираем второй слой.
  let found = findFile(outDir, 'app.asar');
  if (!found) {
    for (const nested of findNested(outDir)) {
      execFileSync('7z', ['x', '-y', `-o${path.join(outDir, 'nested')}`, nested], {
        stdio: 'ignore',
      });
      found = findFile(path.join(outDir, 'nested'), 'app.asar');
      if (found) break;
    }
  }

  if (!found) throw new Error(`app.asar не найден в установщике ${platform}`);
  if (found !== asarPath) await fsp.rename(found, asarPath);
  return asarPath;
}

/** Вложенные архивы внутри распакованного установщика, крупные — вперёд. */
function findNested(dir) {
  const hits = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(7z|zip|hfs|dmg)$/i.test(entry.name))
        hits.push({ full, size: fs.statSync(full).size });
    }
  };
  walk(dir);
  return hits.sort((a, b) => b.size - a.size).map((h) => h.full);
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) return full;
  }
  return null;
}

module.exports = { getLatest, download, extractAsar, META_URL, DOWNLOAD_URL };
