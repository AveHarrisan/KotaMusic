'use strict';
// Electron проверяет целостность app.asar: хеш заголовка архива зашит
// в исполняемый файл (Windows) и в Info.plist (macOS). После подмены asar
// его нужно обновить, иначе клиент откажется запускаться.

const fs = require('./fs');
const crypto = require('crypto');
const asar = require('./asar');

/** Хеш заголовка asar — именно его сверяет Electron. */
function headerHash(asarPath) {
  const { headerString } = asar.readHeader(asarPath);
  return crypto.createHash('sha256').update(headerString).digest('hex');
}

/**
 * Прописывает новый хеш в Info.plist приложения macOS.
 *
 * Там целостность описана словарём ElectronAsarIntegrity: ключ
 * «Resources/app.asar» и рядом hash — те же 64 шестнадцатеричные цифры.
 * Plist бывает и текстовым, и двоичным, но само значение в обоих
 * случаях лежит в файле как ASCII и той же длины, поэтому правим
 * его на месте — структура файла не меняется.
 * @returns {{patched: boolean, absent?: boolean, from?: string, to: string}}
 */
function patchInfoPlist(plistPath, asarPath) {
  const expected = headerHash(asarPath);
  const buf = fs.readFileSync(plistPath);
  const text = buf.toString('latin1');

  const key = text.indexOf('Resources/app.asar');
  if (key < 0) return { patched: false, absent: true, to: expected };

  const found = /[0-9a-f]{64}/.exec(text.slice(key));
  if (!found) return { patched: false, absent: true, to: expected };

  const current = found[0];
  if (current === expected) return { patched: false, to: expected };

  buf.write(expected, key + found.index, 'ascii');
  fs.writeFileSync(plistPath, buf);

  return { patched: true, from: current, to: expected };
}

/**
 * Прописывает новый хеш в исполняемый файл клиента.
 * Меняем только значение внутри блока ELECTRONASAR — длина не меняется,
 * поэтому структура файла остаётся корректной.
 * @returns {{patched: boolean, from?: string, to: string}}
 */
function patchExecutable(exePath, asarPath) {
  const expected = headerHash(asarPath);
  const buf = fs.readFileSync(exePath);

  // Имя ресурса записано в UTF-16, а сами данные — обычный ASCII-JSON:
  // [{"file":"resources\\app.asar","alg":"SHA256","value":"<64 hex>"}]
  const text = buf.toString('latin1');
  const re = /\{"file":"resources[\\\\/]+app\.asar","alg":"SHA256","value":"([0-9a-f]{64})"\}/;
  const found = re.exec(text);

  // На Linux проверки целостности нет вовсе — там правка не нужна.
  if (!found) return { patched: false, absent: true, to: expected };

  const current = found[1];
  if (current === expected) return { patched: false, to: expected };

  const at = text.indexOf(current);
  buf.write(expected, at, 'ascii');
  fs.writeFileSync(exePath, buf);

  return { patched: true, from: current, to: expected };
}

/**
 * Обновляет проверку целостности там, где она есть: в Info.plist на macOS
 * и в исполняемом файле на Windows. На Linux её нет вовсе.
 */
function patchIntegrity(target, asarPath) {
  if (process.platform === 'darwin' && target && target.endsWith('Info.plist')) {
    return patchInfoPlist(target, asarPath);
  }

  return patchExecutable(target, asarPath);
}

module.exports = { headerHash, patchExecutable, patchInfoPlist, patchIntegrity };
