'use strict';
// Поиск установленной Яндекс Музыки и работа с её файлами.

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Стандартные места установки клиента на каждой системе. */
function candidatePaths() {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [path.join(local, 'Programs', 'YandexMusic')];
  }

  if (process.platform === 'darwin') {
    return ['/Applications/Яндекс Музыка.app/Contents'];
  }

  return ['/opt/Яндекс Музыка', path.join(home, '.local', 'share', 'Яндекс Музыка')];
}

/** Исполняемый файл клиента — по нему правится проверка целостности. */
function executableIn(dir) {
  if (process.platform === 'darwin') {
    const macos = path.join(dir, 'MacOS');
    if (!fs.existsSync(macos)) return null;
    const found = fs.readdirSync(macos)[0];
    return found ? path.join(macos, found) : null;
  }

  if (process.platform === 'win32') {
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.exe'));
    if (!files.length) return null;

    // Самый крупный exe — это сам клиент, рядом лежат мелкие служебные.
    return files
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  }

  const files = fs.readdirSync(dir).filter((f) => /^yandex/i.test(f));
  return files.length ? path.join(dir, files[0]) : null;
}

function describe(dir) {
  const asar = path.join(dir, 'resources', 'app.asar');
  if (!fs.existsSync(asar)) return null;

  let version = null;
  try {
    const asarLib = require('@electron/asar');
    version = JSON.parse(asarLib.extractFile(asar, 'package.json').toString()).version;
  } catch {}

  const backup = asar + '.original';

  return {
    dir,
    asar,
    backup,
    executable: executableIn(dir),
    version,
    installed: fs.existsSync(backup),
  };
}

/** Ищет клиент в стандартных местах. */
function find() {
  for (const dir of candidatePaths()) {
    const info = describe(dir);
    if (info) return info;
  }
  return null;
}

/** Занятые файлы означают запущенный клиент — трогать их нельзя. */
function isRunning(info) {
  for (const file of [info.asar, info.executable].filter(Boolean)) {
    try {
      fs.closeSync(fs.openSync(file, 'r+'));
    } catch {
      return true;
    }
  }
  return false;
}

module.exports = { find, describe, isRunning, candidatePaths };
