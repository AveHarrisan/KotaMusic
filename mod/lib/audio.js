'use strict';
// Приведение скачанного файла в обычный вид.
//
// Яндекс отдаёт FLAC внутри контейнера MP4 — проигрыватели такое понимают
// далеко не все. Достаём из контейнера звук и собираем настоящий .flac,
// а заодно пишем название, исполнителя, альбом и обложку. Сторонние
// программы (ffmpeg и подобные) для этого не нужны.

/** Перебор коробок MP4 на одном уровне. */
function* boxes(buffer, start = 0, end = buffer.length) {
  let offset = start;

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let header = 8;

    if (size === 1) {
      // Размер не влез в четыре байта — лежит следующими восемью.
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset; // коробка до конца файла
    }

    if (size < header || offset + size > end) return;

    yield { type, start: offset, body: offset + header, end: offset + size };
    offset += size;
  }
}

/** Первая коробка с таким именем на любой глубине. */
function find(buffer, path, start = 0, end = buffer.length) {
  const [head, ...rest] = path;

  for (const box of boxes(buffer, start, end)) {
    if (box.type !== head) continue;
    if (!rest.length) return box;

    // У некоторых коробок перед вложенными лежат свои поля.
    const skip = head === 'stsd' ? 8 : head === 'meta' ? 4 : 0;
    const found = find(buffer, rest, box.body + skip, box.end);
    if (found) return found;
  }

  return null;
}

/** Таблицы, по которым звук разложен внутри MP4. */
function sampleTable(buffer, stbl) {
  const read = (type) => find(buffer, [type], stbl.body, stbl.end);

  const stsz = read('stsz');
  const stco = read('stco') || read('co64');
  const stsc = read('stsc');
  if (!stsz || !stco || !stsc) return null;

  const uniform = buffer.readUInt32BE(stsz.body + 4);
  const count = buffer.readUInt32BE(stsz.body + 8);

  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    sizes.push(uniform || buffer.readUInt32BE(stsz.body + 12 + i * 4));
  }

  const wide = buffer.toString('latin1', stco.start + 4, stco.start + 8) === 'co64';
  const chunkCount = buffer.readUInt32BE(stco.body + 4);

  const chunks = [];
  for (let i = 0; i < chunkCount; i += 1) {
    chunks.push(
      wide
        ? Number(buffer.readBigUInt64BE(stco.body + 8 + i * 8))
        : buffer.readUInt32BE(stco.body + 8 + i * 4)
    );
  }

  const runs = [];
  const runCount = buffer.readUInt32BE(stsc.body + 4);
  for (let i = 0; i < runCount; i += 1) {
    const at = stsc.body + 8 + i * 12;
    runs.push({
      firstChunk: buffer.readUInt32BE(at),
      perChunk: buffer.readUInt32BE(at + 4),
    });
  }

  return { sizes, chunks, runs };
}

/** Куски звука по порядку: из таблиц собираем настоящие отрезки файла. */
function samples(buffer, table) {
  const parts = [];
  let index = 0;

  for (let chunk = 0; chunk < table.chunks.length && index < table.sizes.length; chunk += 1) {
    let perChunk = table.runs[table.runs.length - 1]?.perChunk || 1;

    for (let r = 0; r < table.runs.length; r += 1) {
      const next = table.runs[r + 1];
      if (chunk + 1 >= table.runs[r].firstChunk && (!next || chunk + 1 < next.firstChunk)) {
        perChunk = table.runs[r].perChunk;
        break;
      }
    }

    let offset = table.chunks[chunk];
    for (let i = 0; i < perChunk && index < table.sizes.length; i += 1) {
      const size = table.sizes[index];
      parts.push(buffer.subarray(offset, offset + size));
      offset += size;
      index += 1;
    }
  }

  return parts;
}

/** Заголовок блока сведений FLAC — он же STREAMINFO из коробки dfLa. */
function streamInfoFrom(buffer, stsd) {
  const entry = find(buffer, ['fLaC'], stsd.body + 8, stsd.end);
  if (!entry) return null;

  // Внутри записи сперва лежат поля звука (28 байт: каналы, разрядность,
  // частота и служебное), и только потом коробка dfLa с настоящими
  // блоками FLAC — первым в ней STREAMINFO.
  const dfla = find(buffer, ['dfLa'], entry.body + 28, entry.end);
  if (!dfla) return null;

  const blocks = dfla.body + 4; // версия и флаги
  const length = buffer.readUIntBE(blocks + 1, 3);
  return buffer.subarray(blocks + 4, blocks + 4 + length);
}

/** Блок метаданных FLAC. */
function flacBlock(type, payload, last = false) {
  const header = Buffer.alloc(4);
  header[0] = (last ? 0x80 : 0) | type;
  header.writeUIntBE(payload.length, 1, 3);
  return Buffer.concat([header, payload]);
}

/** Подписи в формате Vorbis: «ИМЯ=значение». */
function vorbisComment(tags) {
  const vendor = Buffer.from('KotaMusic', 'utf8');
  const lines = Object.entries(tags)
    .filter(([, value]) => value)
    .map(([name, value]) => Buffer.from(`${name}=${value}`, 'utf8'));

  const parts = [Buffer.alloc(4), vendor, Buffer.alloc(4)];
  parts[0].writeUInt32LE(vendor.length, 0);
  parts[2].writeUInt32LE(lines.length, 0);

  for (const line of lines) {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(line.length, 0);
    parts.push(size, line);
  }

  return Buffer.concat(parts);
}

/** Обложка внутри FLAC: тип 3 — «передняя сторона обложки». */
function flacPicture(cover, mime = 'image/jpeg') {
  const type = Buffer.alloc(4);
  type.writeUInt32BE(3, 0);

  const mimeBuf = Buffer.from(mime, 'latin1');
  const mimeLen = Buffer.alloc(4);
  mimeLen.writeUInt32BE(mimeBuf.length, 0);

  const description = Buffer.alloc(4); // без подписи
  const sizes = Buffer.alloc(16); // ширина, высота, глубина, число цветов
  const dataLen = Buffer.alloc(4);
  dataLen.writeUInt32BE(cover.length, 0);

  return Buffer.concat([type, mimeLen, mimeBuf, description, sizes, dataLen, cover]);
}

/**
 * Собирает настоящий .flac из того, что лежит в контейнере MP4.
 * Возвращает null, если это не FLAC — тогда файл оставляем как есть.
 */
function flacFromMp4(buffer, { tags = {}, cover = null } = {}) {
  const stsd = find(buffer, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
  if (!stsd) return null;

  const streamInfo = streamInfoFrom(buffer, stsd);
  if (!streamInfo || streamInfo.length !== 34) return null;

  const stbl = find(buffer, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const table = sampleTable(buffer, stbl);
  if (!table) return null;

  const audio = samples(buffer, table);
  if (!audio.length) return null;

  const blocks = [flacBlock(0, streamInfo)];
  const comment = vorbisComment(tags);
  if (cover) {
    blocks.push(flacBlock(4, comment), flacBlock(6, flacPicture(cover), true));
  } else {
    blocks.push(flacBlock(4, comment, true));
  }

  return Buffer.concat([Buffer.from('fLaC', 'latin1'), ...blocks, ...audio]);
}

/** Размер в записи ID3: семь бит в каждом байте. */
function syncsafe(value) {
  const out = Buffer.alloc(4);
  out[0] = (value >> 21) & 0x7f;
  out[1] = (value >> 14) & 0x7f;
  out[2] = (value >> 7) & 0x7f;
  out[3] = value & 0x7f;
  return out;
}

function id3Frame(id, payload) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/** Текстовое поле: пишем в UTF-16 — так его понимают и старые программы. */
function id3Text(id, value) {
  const text = Buffer.from(`﻿${value} `, 'utf16le');
  return id3Frame(id, Buffer.concat([Buffer.from([1]), text]));
}

/**
 * Запись ID3v2.3 для MP3: названия и обложка. Возвращает готовый файл.
 */
function withId3(buffer, { tags = {}, cover = null, lyrics = null } = {}) {
  const frames = [];

  const map = { TIT2: tags.TITLE, TPE1: tags.ARTIST, TALB: tags.ALBUM, TYER: tags.DATE, TCON: tags.GENRE };
  for (const [id, value] of Object.entries(map)) {
    if (value) frames.push(id3Text(id, String(value)));
  }

  if (cover) {
    frames.push(
      id3Frame(
        'APIC',
        Buffer.concat([
          Buffer.from([0]), // подписи в latin1
          Buffer.from('image/jpeg ', 'latin1'),
          Buffer.from([3]), // передняя сторона обложки
          Buffer.from(' ', 'latin1'),
          cover,
        ])
      )
    );
  }

  if (lyrics) {
    frames.push(
      id3Frame(
        'USLT',
        Buffer.concat([
          Buffer.from([1]),
          Buffer.from('rus', 'latin1'),
          Buffer.from('﻿ ', 'utf16le'),
          Buffer.from(`﻿${lyrics}`, 'utf16le'),
        ])
      )
    );
  }

  if (!frames.length) return buffer;

  const body = Buffer.concat(frames);
  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([3, 0, 0]),
    syncsafe(body.length),
  ]);

  // Если запись уже есть, старую отбрасываем, чтобы не копить.
  let audio = buffer;
  if (buffer.length > 10 && buffer.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    audio = buffer.subarray(10 + size);
  }

  return Buffer.concat([header, body, audio]);
}

module.exports = { flacFromMp4, withId3, boxes, find };
