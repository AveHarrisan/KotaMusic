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

// Считаем только сам мод. Установщик скачивают один раз, а дальше мод
// обновляет себя сам — по числу загрузок архива и видно, сколько людей
// им пользуются.
const COUNTED = new Set(['app.asar']);

// ⚠️Счётчик GitHub живёт у файла, а не у релиза: при выпуске новой версии
// мода файл в релизе заменяется, и его счётчик начинается с нуля. Поэтому
// храним прошлые числа рядом и переносим их в «накопленное», когда счётчик
// у файла падает.
const STATE = 'downloads-state.json';

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

/** Прошлые числа: что мы видели в предыдущий раз. */
async function readState() {
  try {
    return JSON.parse(await fs.readFile(path.join(OUT, STATE), 'utf8'));
  } catch {
    return { carried: 0, assets: {} };
  }
}

/**
 * Складывает загрузки с оглядкой на прошлый раз. Возвращает новое
 * состояние и общее число — оно только растёт.
 */
function combine(previous, list) {
  const state = { carried: previous.carried || 0, assets: {} };
  const seen = [];

  for (const release of list) {
    for (const asset of release.assets || []) {
      if (!COUNTED.has(asset.name)) continue;

      const key = `${release.tag_name}/${asset.name}`;
      const before = previous.assets?.[key] || 0;

      // Файл заменили новой сборкой — прошлые загрузки уже не вернуть,
      // поэтому уносим их в накопленное, чтобы общее число не падало.
      if (asset.download_count < before) {
        state.carried += before;
        seen.push(`${key}: ${before} перенесено`);
      }

      state.assets[key] = asset.download_count;
      seen.push(`${key}: ${asset.download_count}`);
    }
  }

  // Релиз могли удалить — его загрузки тоже сохраняем.
  for (const [key, value] of Object.entries(previous.assets || {})) {
    if (!(key in state.assets)) state.carried += value;
  }

  const downloads =
    state.carried + Object.values(state.assets).reduce((sum, value) => sum + value, 0);

  return { state, downloads, seen };
}

async function main() {
  const list = await releases();
  const { state, downloads, seen } = combine(await readState(), list);

  const version = await modVersion(list);

  await fs.mkdir(OUT, { recursive: true });

  await fs.writeFile(
    path.join(OUT, 'downloads.json'),
    JSON.stringify(badge('Загрузок', String(downloads), 'success'), null, 2) + '\n'
  );

  await fs.writeFile(
    path.join(OUT, STATE),
    JSON.stringify(state, null, 2) + '\n'
  );

  await fs.writeFile(
    path.join(OUT, 'mod.json'),
    JSON.stringify(badge('Версия мода', version || '—', 'blue'), null, 2) + '\n'
  );

  console.log('Загрузок:', downloads, `(накоплено ${state.carried}; ${seen.join(', ')})`);
  console.log('Версия мода:', version || 'неизвестна');
}

module.exports = { combine, COUNTED };

if (require.main === module) {
  main().catch((e) => {
    console.error('Значки не обновились:', e.message);
    process.exit(1);
  });
}
