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

// Разовый сбой сети до раздачи Яндекса не должен ронять автосборку и
// заводить задачу «врезки не легли». Поэтому каждый запрос — с
// ограничением времени и несколькими повторами.
const ATTEMPTS = 5;
const PAUSES_MS = [10_000, 30_000, 60_000, 120_000];

/** Ошибка сети: по ней прогон не считается поломкой мода. */
class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NETWORK';
  }
}

/** fetch с повторами; tries и pause подменяются в проверках. */
async function fetchRetry(url, { timeoutMs = 60_000, read, tries = ATTEMPTS, pause = PAUSES_MS } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      // 404 повторять бесполезно — такого файла нет.
      if (res.status === 404) throw Object.assign(new Error(`${url}: HTTP 404`), { final: true });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await read(res);
    } catch (err) {
      if (err.final) throw err;
      last = err;
      const why = err.cause?.code || err.message;
      if (attempt < tries) {
        const wait = pause[Math.min(attempt - 1, pause.length - 1)];
        console.log(`Сеть: ${why} — попытка ${attempt} из ${tries}, повтор через ${wait / 1000} с`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw new NetworkError(`Сбой сети до раздачи Яндекса: ${url} — ${last.cause?.code || last.message}`);
}

/** Текущая версия клиента и адреса установщиков именно этой версии. */
async function getLatest() {
  const downloads = {};
  let version = null;

  for (const [key, source] of Object.entries(SOURCES)) {
    const text = await fetchRetry(META_BASE + source.meta, { read: (res) => res.text() });
    const meta = parseMeta(text, source.file);
    if (key === 'windows') version = meta.version;
    // Раздача под разные системы может обновляться не одновременно —
    // ссылку на чужую версию не отдаём вовсе.
    if (meta.url && meta.version === version) downloads[key] = meta.url;
  }

  if (!version) throw new Error('Не удалось прочитать версию из latest.yml');
  return { version, downloads };
}

async function download(url, dest) {
  const data = await fetchRetry(url, {
    timeoutMs: 10 * 60_000,
    read: async (res) => {
      const buf = Buffer.from(await res.arrayBuffer());
      // Оборванная закачка — тоже повод повторить, а не собирать из обрубка.
      const expected = Number(res.headers.get('content-length'));
      if (expected && buf.length !== expected) {
        throw new Error(`скачано ${buf.length} из ${expected} байт`);
      }
      return buf;
    },
  });
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, data);
  return dest;
}

/** Достаёт app.asar из установщика. Каждая платформа пакуется по-своему. */
async function extractAsar(installerPath, platform, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const asarPath = path.join(outDir, 'app.asar');

  if (platform === 'linux') {
    execFileSync('ar', ['x', installerPath], { cwd: outDir });
    const data = fs.readdirSync(outDir).find((f) => f.startsWith('data.tar'));
    // ⚠️ 22.10.2026 Яндекс выложил .deb 5.124.1 размером 96 байт — пустой
    // архив без data.tar. Раньше это падало невнятным «tar: undefined».
    if (!data) {
      const size = fs.statSync(installerPath).size;
      const err = new Error(`Битый установщик от Яндекса: в .deb нет data.tar (${size} байт)`);
      err.code = 'BROKEN_INSTALLER';
      throw err;
    }
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
  parseMeta, getLatest, download, extractAsar, fetchRetry, NetworkError, META_BASE, CDN_BASE };
