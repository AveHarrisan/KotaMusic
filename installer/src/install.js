'use strict';
// Установка и снятие мода.
//
// Порядок важен: сначала убеждаемся, что оба файла свободны, и только
// потом трогаем их. Иначе можно подменить app.asar и не суметь поправить
// хеш в исполняемом файле — тогда клиент перестанет запускаться.

const fs = require('./fs');
const fsp = fs.promises;

const { isRunning } = require('./client');
const { patchIntegrity, headerHash } = require('./integrity');

async function install(info, modPath) {
  if (isRunning(info)) throw new Error('Яндекс Музыка запущена — закройте её и повторите');

  // Резервную копию делаем один раз, с нетронутого клиента.
  if (!fs.existsSync(info.backup)) {
    await fsp.copyFile(info.asar, info.backup);
  }
  const target = info.integrityTarget || info.executable;

  if (target && !fs.existsSync(target + '.original')) {
    await fsp.copyFile(target, target + '.original');
  }

  await fsp.copyFile(modPath, info.asar);

  // Часть файлов мода должна лежать распакованной рядом с архивом:
  // системные вызовы Windows не читают их изнутри.
  const unpacked = modPath + '.unpacked';
  if (fs.existsSync(unpacked)) {
    await fsp.cp(unpacked, info.asar + '.unpacked', { recursive: true, force: true });
  }

  // Windows и macOS проверяют целостность архива — обновляем хеш.
  if (target) {
    try {
      const result = patchIntegrity(target, info.asar);
      if (result.absent) {
        // Проверки целостности нет — так бывает на Linux, это нормально.
      }
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

  // Возвращаем и файл с проверкой целостности: на macOS это Info.plist.
  const target = info.integrityTarget || info.executable;
  const original = target && target + '.original';

  if (original && fs.existsSync(original)) {
    await fsp.copyFile(original, target);
  }
}

module.exports = { install, uninstall };
