'use strict';
// Поиск установленной Яндекс Музыки и работа с её файлами.

const fs = require('./fs');
const path = require('path');
const os = require('os');

/** Стандартные места установки клиента на каждой системе. */
function candidatePaths() {
  const home = os.homedir();

  // Путь можно задать вручную: установка бывает и не в стандартном месте.
  if (process.env.KOTAMUSIC_CLIENT_DIR) return [process.env.KOTAMUSIC_CLIENT_DIR];

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

  const { extractFile, readHeader } = require('./asar');

  let version = null;
  let installed = false;

  try {
    version = JSON.parse(extractFile(asar, 'package.json').toString()).version;

    // Установлен — значит внутри архива лежит наша папка. Наличие
    // резервной копии о текущем состоянии ничего не говорит: её мы
    // держим и после удаления мода.
    installed = Boolean(readHeader(asar).header.files?.kotamusic);
  } catch {}

  const backup = asar + '.original';

  return {
    dir,
    asar,
    backup,
    executable: executableIn(dir),
    version,
    installed,
    hasBackup: fs.existsSync(backup),
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
