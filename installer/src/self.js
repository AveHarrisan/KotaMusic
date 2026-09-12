'use strict';
// Своя версия установщика и проверка, не вышла ли новее.
//
// Обновляться сам установщик не умеет и не должен: его запускают один
// раз, а скачанный файл остаётся в «Загрузках» и после подмены. Поэтому
// просто говорим, что есть свежая сборка, и открываем страницу релиза.

const { REPO } = require('./releases');

const TAG = 'installer';
const INFO = `https://github.com/${REPO}/releases/download/${TAG}/installer-info.json`;

const PAGE = `https://github.com/${REPO}/releases/tag/${TAG}`;

/** Версия самого установщика. */
function version() {
  try {
    return require('electron').app.getVersion();
  } catch {
    return require('../package.json').version;
  }
}

/** Сравнение версий вида 1.2.3. */
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

/**
 * Что выложено в релизе установщика. Файла может не быть — у сборок,
 * выпущенных до того, как мы начали его класть; тогда молчим.
 */
async function latest() {
  try {
    const response = await fetch(INFO, { headers: { 'User-Agent': 'KotaMusic' } });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.version) return null;

    return { version: data.version, page: PAGE };
  } catch {
    return null;
  }
}

/** Версия своя, версия выложенная и нужно ли обновляться. */
async function state() {
  const installed = version();
  const published = await latest();

  return {
    version: installed,
    latest: published?.version || null,
    page: PAGE,
    outdated: Boolean(published && newer(published.version, installed)),
  };
}

module.exports = { version, state, newer, PAGE };
