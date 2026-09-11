'use strict';
// Поиск установленной Яндекс Музыки и работа с её файлами.

const fs = require('./fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

/**
 * Где Windows записала установку клиента. Папку выбирает человек, и она
 * бывает какой угодно — стандартный путь тут не помощник, зато запись
 * об установке ведёт прямо к ней.
 */
function fromRegistry() {
  if (process.platform !== 'win32') return [];

  const script = `
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $roots = @(
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    Get-ItemProperty $roots -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*Музык*' -or $_.DisplayName -like '*Yandex*Music*' } |
      ForEach-Object { if ($_.InstallLocation) { $_.InstallLocation } elseif ($_.DisplayIcon) { $_.DisplayIcon } }
  `;

  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });

    return (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/,\d+$/, '')) // «путь\файл.exe,0»
      .filter(Boolean)
      .map((entry) => (/\.exe$/i.test(entry) ? path.dirname(entry) : entry));
  } catch {
    return [];
  }
}

/** Папка, выбранная человеком вручную, — она главнее любых догадок. */
function settingsFile() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'installer.json');
  } catch {
    return null;
  }
}

function remembered() {
  const file = settingsFile();
  if (!file || !fs.existsSync(file)) return null;

  try {
    const dir = JSON.parse(fs.readFileSync(file, 'utf8')).clientDir;
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

function remember(dir) {
  const file = settingsFile();
  if (!file) return;

  try {
    fs.writeFileSync(file, JSON.stringify({ clientDir: dir }, null, 2));
  } catch {}
}

/** Стандартные места установки клиента на каждой системе. */
function candidatePaths() {
  const home = os.homedir();

  // Путь можно задать вручную: установка бывает и не в стандартном месте.
  if (process.env.KOTAMUSIC_CLIENT_DIR) return [process.env.KOTAMUSIC_CLIENT_DIR];

  const chosen = remembered();
  if (chosen) return [chosen];

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    return [
      ...fromRegistry(),
      path.join(local, 'Programs', 'YandexMusic'),
      path.join(local, 'Programs', 'Яндекс Музыка'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'YandexMusic'),
    ];
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

module.exports = { find, describe, isRunning, candidatePaths, remember, remembered };
