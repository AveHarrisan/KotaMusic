'use strict';
// Установка и снятие мода.
//
// Порядок важен: сначала убеждаемся, что оба файла свободны, и только
// потом трогаем их. Иначе можно подменить app.asar и не суметь поправить
// хеш в исполняемом файле — тогда клиент перестанет запускаться.

const fs = require('fs');
const fsp = require('fs/promises');

const { isRunning } = require('./client');
const { patchExecutable, headerHash } = require('./integrity');

async function install(info, modPath) {
  if (isRunning(info)) throw new Error('Яндекс Музыка запущена — закройте её и повторите');

  // Резервную копию делаем один раз, с нетронутого клиента.
  if (!fs.existsSync(info.backup)) {
    await fsp.copyFile(info.asar, info.backup);
  }
  if (info.executable && !fs.existsSync(info.executable + '.original')) {
    await fsp.copyFile(info.executable, info.executable + '.original');
  }

  await fsp.copyFile(modPath, info.asar);

  // Часть файлов мода должна лежать распакованной рядом с архивом:
  // системные вызовы Windows не читают их изнутри.
  const unpacked = modPath + '.unpacked';
  if (fs.existsSync(unpacked)) {
    await fsp.cp(unpacked, info.asar + '.unpacked', { recursive: true, force: true });
  }

  // Windows и macOS проверяют целостность архива — обновляем хеш.
  if (info.executable) {
    try {
      patchExecutable(info.executable, info.asar);
    } catch (e) {
      // Не смогли — возвращаем оригинал, чтобы не оставить клиент сломанным.
      await fsp.copyFile(info.backup, info.asar);
      throw new Error(`Не удалось обновить проверку целостности: ${e.message}`);
    }
  }

  return { hash: headerHash(info.asar) };
}

async function uninstall(info) {
  if (isRunning(info)) throw new Error('Яндекс Музыка запущена — закройте её и повторите');
  if (!fs.existsSync(info.backup)) throw new Error('Резервной копии нет, откатывать нечего');

  await fsp.copyFile(info.backup, info.asar);

  const originalExe = info.executable && info.executable + '.original';
  if (originalExe && fs.existsSync(originalExe)) {
    await fsp.copyFile(originalExe, info.executable);
  }
}

module.exports = { install, uninstall };
