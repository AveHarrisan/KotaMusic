'use strict';
// Минимальное чтение архива asar: заголовок и отдельные файлы.
//
// Своё вместо библиотеки: @electron/asar перешла на новый формат модулей
// и внутри Electron не подключается, а нам нужны всего две вещи —
// строка заголовка для проверки целостности и package.json клиента.

const fs = require('./fs');

/** Заголовок: 16 служебных байт, дальше JSON с описанием файлов. */
function readHeader(file) {
  const fd = fs.openSync(file, 'r');

  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, 16, 0);

    const jsonLength = prefix.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);

    return {
      headerString: json.toString('utf8'),
      header: JSON.parse(json.toString('utf8')),
      // Данные файлов начинаются сразу за заголовком.
      baseOffset: 8 + prefix.readUInt32LE(4),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Содержимое файла внутри архива по пути вида «package.json». */
function extractFile(archive, filePath) {
  const { header, baseOffset } = readHeader(archive);

  let node = header;
  for (const part of filePath.split('/')) {
    node = node.files?.[part];
    if (!node) throw new Error(`В архиве нет файла ${filePath}`);
  }

  const fd = fs.openSync(archive, 'r');
  try {
    const buffer = Buffer.alloc(node.size);
    fs.readSync(fd, buffer, 0, node.size, baseOffset + Number(node.offset));
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readHeader, extractFile };
