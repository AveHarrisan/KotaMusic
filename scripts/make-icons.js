'use strict';
// Иконки для кнопок на панели задач Windows. Рисуем сами: тащить ради
// четырёх картинок библиотеку или бинарники в репозиторий незачем.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 16;

/** Минимальный кодировщик PNG: RGBA без сжатия картинки как таковой. */
function png(pixels) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;

  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0; // фильтр строки
    for (let x = 0; x < SIZE; x++) {
      const on = pixels(x, y);
      raw[offset++] = 255;
      raw[offset++] = 255;
      raw[offset++] = 255;
      raw[offset++] = on ? 255 : 0;
    }
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);

    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);

    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // бит на канал
  header[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let table = null;
function crc32(buffer) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }

  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return crc ^ -1;
}

/** Треугольник, направленный вправо или влево. */
const triangle = (left, right, flip) => (x, y) => {
  const px = flip ? SIZE - 1 - x : x;
  if (px < left || px > right) return false;

  const progress = (px - left) / (right - left);
  const half = (1 - progress) * (SIZE / 2 - 1);
  return Math.abs(y - (SIZE - 1) / 2) <= half;
};

const bar = (from, to) => (x, y) => x >= from && x <= to && y >= 2 && y <= SIZE - 3;

const any =
  (...shapes) =>
  (x, y) =>
    shapes.some((shape) => shape(x, y));

const ICONS = {
  play: triangle(4, 13, false),
  pause: any(bar(4, 6), bar(9, 11)),
  next: any(triangle(3, 10, false), bar(11, 13)),
  previous: any(triangle(3, 10, true), bar(2, 4)),
};

const dir = path.join(__dirname, '..', 'mod', 'assets');
fs.mkdirSync(dir, { recursive: true });

for (const [name, shape] of Object.entries(ICONS)) {
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, png(shape));
  console.log('готово:', path.relative(path.join(__dirname, '..'), file));
}
