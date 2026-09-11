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

/**
 * Исполняемый файл клиента — по нему правится проверка целостности.
 * Смотрим на саму папку, а не на систему: установку с одной системы
 * в папку другой (например из WSL) тоже надо обслуживать правильно.
 */
function executableIn(dir) {
  const macos = path.join(dir, 'MacOS');

  if (fs.existsSync(macos)) {
    const found = fs.readdirSync(macos)[0];
    return found ? path.join(macos, found) : null;
  }

  const entries = fs.readdirSync(dir);

  // Самый крупный exe — это сам клиент, рядом лежат мелкие служебные.
  const exe = entries
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

  if (exe) return exe;

  const linux = entries.filter((f) => /^(yandex|Яндекс)/i.test(f) && !f.includes('.'));
  return linux.length ? path.join(dir, linux[0]) : null;
}

/**
 * Файл, в котором лежит проверка целостности: на macOS это Info.plist
 * рядом с Resources, на остальных системах — сам исполняемый файл.
 */
function integrityTargetIn(dir, executable) {
  const plist = path.join(dir, 'Info.plist');
  return fs.existsSync(plist) ? plist : executable;
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
    integrityTarget: integrityTargetIn(dir, executableIn(dir)),
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
