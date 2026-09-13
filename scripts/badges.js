'use strict';
// Значки для описания проекта.
//
// Готовый значок shields считает загрузки всех файлов релиза подряд,
// включая служебные: build-info.json мод скачивает сам при каждой проверке
// обновлений, installer-info.json — установщик. Из-за них «загрузок» росло
// само по себе и ничего не значило. Поэтому считаем сами: только то, что
// человек действительно скачивает.

const fs = require('fs/promises');
const path = require('path');

const REPO = 'AveHarrisan/KotaMusic';
const API = `https://api.github.com/repos/${REPO}/releases`;
const OUT = path.join(__dirname, '..', 'docs', 'badges');

// Мод и установщики под три системы. Всё остальное — служебное.
const COUNTED = new Set([
  'app.asar',
  'KotaMusic-Setup.exe',
  'KotaMusic.AppImage',
  'KotaMusic.dmg',
]);

/** Формат значка-«конечной точки» shields. */
const badge = (label, message, color) => ({
  schemaVersion: 1,
  label,
  message,
  color,
});

async function releases() {
  const response = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KotaMusic' },
  });

  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);
  return response.json();
}

/** Версия мода лежит рядом с архивом, в build-info.json релиза. */
async function modVersion(list) {
  const mod = list.find((r) => /^mod-/.test(r.tag_name));
  const info = mod?.assets?.find((a) => a.name === 'build-info.json');
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

async function main() {
  const list = await releases();

  let downloads = 0;
  const seen = [];

  for (const release of list) {
    for (const asset of release.assets || []) {
      if (!COUNTED.has(asset.name)) continue;

      downloads += asset.download_count;
      seen.push(`${asset.name}: ${asset.download_count}`);
    }
  }

  const version = await modVersion(list);

  await fs.mkdir(OUT, { recursive: true });

  await fs.writeFile(
    path.join(OUT, 'downloads.json'),
    JSON.stringify(badge('Загрузок', String(downloads), 'success'), null, 2) + '\n'
  );

  await fs.writeFile(
    path.join(OUT, 'mod.json'),
    JSON.stringify(badge('Версия мода', version || '—', 'blue'), null, 2) + '\n'
  );

  console.log('Загрузок:', downloads, `(${seen.join(', ')})`);
  console.log('Версия мода:', version || 'неизвестна');
}

main().catch((e) => {
  console.error('Значки не обновились:', e.message);
  process.exit(1);
});
