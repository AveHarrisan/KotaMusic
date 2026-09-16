'use strict';
// Работа с официальной раздачей клиента Яндекс Музыки.
// Ничего чужого мы не храним: всё качается с их CDN на время сборки.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

const META_BASE = 'https://music-desktop-application.s3.yandex.net/stable/';
const CDN_BASE = 'https://desktop.app.music.yandex.net/stable/';

// ⚠️ Ссылки берём из тех же файлов, что и версию. download.json у Яндекса
// обновляется позже: 16.09.2026 latest.yml уже говорил 5.120.0, а
// download.json ещё отдавал установщики 5.119.0 — и под видом 5.120
// собрался и разошёлся мод из клиента 5.119.
const SOURCES = {
  windows: { meta: 'latest.yml', file: /\.exe$/ },
  macos: { meta: 'latest-mac.yml', file: /\.dmg$/ },
  linux: { meta: 'latest-linux.yml', file: /\.deb$/ },
};

/** Версия из yml и имя нужного файла из списка files. */
function parseMeta(text, pattern) {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const base = /^\s*UPDATE_URL:\s*(\S+)\s*$/m.exec(text)?.[1] || CDN_BASE;
  const names = [...text.matchAll(/^\s*(?:-\s*url|path):\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const file = names.find((name) => pattern.test(name));
  return { version, url: file ? new URL(file, base.endsWith('/') ? base : base + '/').href : null };
}

/** Текущая версия клиента и адреса установщиков именно этой версии. */
async function getLatest() {
  const downloads = {};
  let version = null;

  for (const [key, source] of Object.entries(SOURCES)) {
    const res = await fetch(META_BASE + source.meta);
    if (!res.ok) throw new Error(`${source.meta}: HTTP ${res.status}`);

    const meta = parseMeta(await res.text(), source.file);
    if (key === 'windows') version = meta.version;
    // Раздача под разные системы может обновляться не одновременно —
    // ссылку на чужую версию не отдаём вовсе.
    if (meta.url && meta.version === version) downloads[key] = meta.url;
  }

  if (!version) throw new Error('Не удалось прочитать версию из latest.yml');
  return { version, downloads };
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

module.exports = {
  parseMeta, getLatest, download, extractAsar, META_BASE, CDN_BASE };
