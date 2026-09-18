'use strict';
// Скачивание треков в обычные файлы: трек, альбом, плейлист.
//
// Файл приходит зашифрованным потоком (AES-CTR), ключ Яндекс отдаёт в том
// же ответе, что и ссылку. Ничего чужого мы не обходим: без подписки
// сервер просто не ответит.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { app, dialog, ipcMain, shell, BrowserWindow } = require('electron');

const api = require('./tracks-api');
const audio = require('./audio');
const settings = require('./settings');
const notice = require('./notice');
const log = require('./log');

const CHANNEL_PROGRESS = 'kotamusic:download:progress';

// Сколько треков качаем одновременно: столько же берёт клиент.
const PARALLEL = 3;

// Доля прогресса, которая приходится на саму загрузку; остальное —
// на теги и обложку.
const DOWNLOAD_SHARE = 0.9;

let queue = Promise.resolve();

// Скорость считаем по всем загрузкам разом: показываем одну общую,
// а не по треку — так понятнее, когда качается альбом в три потока.
const speed = { bytes: 0, since: Date.now(), value: 0 };

function addBytes(count) {
  speed.bytes += count;

  const elapsed = Date.now() - speed.since;
  if (elapsed < 700) return;

  const now = (speed.bytes / elapsed) * 1000;
  // Сглаживаем: без этого цифра прыгает от куска к куску.
  speed.value = speed.value ? speed.value * 0.6 + now * 0.4 : now;
  speed.bytes = 0;
  speed.since = Date.now();
}

/** «12,3 МБ/с» — привычными единицами. */
function speedText() {
  if (!speed.value || Date.now() - speed.since > 4000) return '';

  const units = ['Б/с', 'КБ/с', 'МБ/с'];
  let value = speed.value;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// Качество трека меняться не может — храним ответы, чтобы не спрашивать
// одно и то же при каждой перерисовке панели.
const quality = new Map();

/**
 * Расширение по кодеку. FLAC Яндекс отдаёт внутри контейнера MP4 — мы
 * его оттуда достаём, поэтому файл получается настоящим .flac.
 */
function extensionFor(codec) {
  const plain = String(codec || '').replace(/-mp4$/, '');
  if (plain === 'aac' || plain === 'he-aac') return 'm4a';
  if (plain === 'flac') return 'flac';
  if (plain === 'mp3') return 'mp3';
  return 'm4a';
}

/** Год выхода: у альбома он бывает числом, бывает датой. */
function yearOf(track) {
  const album = track?.albums?.[0] || {};
  const raw = album.year || album.releaseDate || track?.year || '';
  const found = /(\d{4})/.exec(String(raw));
  return found ? found[1] : '';
}

/** Названия для тегов внутри файла. */
function tagsFor(track) {
  const album = track?.albums?.[0] || {};

  return {
    TITLE: track?.title || '',
    ARTIST: artistsOf(track),
    ALBUM: album.title || '',
    DATE: yearOf(track),
    GENRE: album.genre || '',
    TRACKNUMBER: track?.albums?.[0]?.trackPosition?.index
      ? String(track.albums[0].trackPosition.index)
      : '',
  };
}

/** Имя файла без запрещённых символов. */
function safeName(value) {
  return String(value || '')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function artistsOf(track) {
  const names = (track?.artists || []).map((artist) => artist.name).filter(Boolean);
  return names.length ? names.join(', ') : 'Неизвестный исполнитель';
}

function fileNameFor(track, codec) {
  return `${safeName(artistsOf(track))} — ${safeName(track?.title || 'Без названия')}.${extensionFor(codec)}`;
}

/** Куда складываем файлы. */
function targetDir() {
  const chosen = settings.get().downloadDir;
  if (chosen) return chosen;

  return path.join(app.getPath('music'), 'YandexMusic');
}

/**
 * Расшифровка потока: ключ приходит шестнадцатеричной строкой, счётчик
 * начинается с нуля — это обычный AES-CTR.
 */
function decryptor(keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const mode = key.length === 32 ? 'aes-256-ctr' : 'aes-128-ctr';
  return crypto.createDecipheriv(mode, key, Buffer.alloc(16));
}

/** Скачивает один файл, сообщая долю. */
async function fetchToFile(url, destination, keyHex, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Файл: HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;

  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    addBytes(chunk.length);
    if (total) onProgress?.((received / total) * DOWNLOAD_SHARE);
  });

  const parts = [source];
  if (keyHex) parts.push(decryptor(keyHex));
  parts.push(fs.createWriteStream(destination));

  await pipeline(parts);
}

/** Сообщение о ходе дела в окно клиента. */
function report(state) {
  if (!state.done) state = { ...state, speed: speedText() };
  if (state.speed) log.debug('Ход дела:', state.text || '', state.speed, `${Math.round((state.share || 0) * 100)}%`);

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(CHANNEL_PROGRESS, state);
  }

  const main = BrowserWindow.getAllWindows()[0];
  if (main && !main.isDestroyed()) {
    main.setProgressBar(state.done ? -1 : Math.max(0, Math.min(1, state.share || 0)));
  }
}

// Обложка у альбома одна на все треки — качаем её один раз.
const covers = new Map();

async function coverFor(track) {
  const uri = track?.coverUri || track?.albums?.[0]?.coverUri;
  if (!uri) return null;

  if (!covers.has(uri)) {
    covers.set(
      uri,
      api.cover(uri).catch((e) => {
        log.debug('Обложка не скачалась:', e.message);
        return null;
      })
    );
  }

  if (covers.size > 50) {
    const first = covers.keys().next().value;
    covers.delete(first);
  }

  return covers.get(uri);
}

/**
 * Уже скачан? Ищем файл с тем же именем в любом из известных форматов.
 * Возвращает путь и время создания — их показываем человеку.
 */
function alreadyHave(track, dir) {
  const folder = dir || targetDir();
  const base = fileNameFor(track, 'flac').replace(/\.flac$/, '');

  for (const kind of ['flac', 'mp3', 'm4a']) {
    const file = path.join(folder, `${base}.${kind}`);
    try {
      const about = fs.statSync(file);
      return { file, at: about.mtimeMs };
    } catch {
      /* нет такого файла */
    }
  }

  return null;
}

/** Спрашивает папку, если её ещё ни разу не выбирали. */
async function ensureDir() {
  if (settings.get().downloadDir) return settings.get().downloadDir;

  const result = await dialog.showOpenDialog({
    title: 'Куда сохранять скачанные треки',
    defaultPath: targetDir(),
    buttonLabel: 'Сохранять сюда',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths.length) return null;

  settings.set({ downloadDir: result.filePaths[0] });
  return result.filePaths[0];
}

/** Скачивает трек и возвращает путь к файлу. */
async function downloadTrack(track, { dir, mp3, onProgress } = {}) {
  const info = await api.fileInfo(track.id, { mp3 });
  if (!info?.url) throw new Error('Яндекс не дал ссылку на файл');

  log.debug('Файл трека:', JSON.stringify({ codec: info.codec, bitrate: info.bitrate, transport: info.transport, container: info.container }));

  const folder = dir || targetDir();
  fs.mkdirSync(folder, { recursive: true });

  const file = path.join(folder, fileNameFor(track, info.codec));
  const temporary = `${file}.part`;

  await fetchToFile(info.url, temporary, info.key, onProgress);

  // Обложку и подписи вшиваем в сам файл, чтобы он выглядел прилично
  // в любой программе, а не только в проводнике рядом с папкой.
  const cover = settings.get().downloadCover === false ? null : await coverFor(track);
  const tags = tagsFor(track);

  const raw = fs.readFileSync(temporary);
  let ready = null;

  if (String(info.codec).startsWith('flac')) {
    ready = audio.flacFromMp4(raw, { tags, cover });
    if (!ready) log.warn('FLAC из контейнера не достался, оставляю как есть:', track.title);
  } else if (String(info.codec) === 'mp3') {
    ready = audio.withId3(raw, { tags, cover });
  }

  fs.writeFileSync(file, ready || raw);
  fs.rmSync(temporary, { force: true });

  // Текст песни кладём рядом: в сам файл его без ffmpeg не записать.
  if (settings.get().downloadLyrics && track.lyricsInfo?.hasAvailableSyncLyrics) {
    try {
      const text = await api.lyrics(track.id);
      if (text) fs.writeFileSync(file.replace(/\.[^.]+$/, '.lrc'), text, 'utf8');
    } catch (e) {
      log.debug('Текст не скачался:', e.message);
    }
  }

  onProgress?.(1);
  return file;
}

/** Ставит задачу в очередь: разом качаем не больше, чем нужно. */
function enqueue(task) {
  queue = queue.then(task, task);
  return queue;
}

/** Скачивание одного трека по его номеру. */
async function single(trackId, { dir = null, force = false } = {}) {
  const [track] = await api.tracksMeta([trackId]);
  if (!track) throw new Error('Трек не найден');

  const title = `${track.title} — ${artistsOf(track)}`;

  // Такой файл уже лежит — спросим человека, качать ли заново.
  if (!force) {
    const have = alreadyHave(track, dir);
    if (have) return { exists: true, title, ...have };
  }

  report({ id: 'single', title, share: 0 });

  try {
    const file = await downloadTrack(track, {
      dir,
      mp3: settings.get().downloadMp3,
      onProgress: (share) => report({ id: 'single', title, share }),
    });

    report({ id: 'single', title, share: 1, done: true, file });
    log.info('Скачан трек:', file);
    return { file };
  } catch (e) {
    report({ id: 'single', title, done: true, error: e.message });
    throw e;
  }
}

/** Скачивание списка треков в свою папку. */
async function many(tracks, title, { ownFolder = null, force = false } = {}) {
  // Альбом и плейлист по желанию ложатся в свою папку — так удобнее
  // искать, — или вперемешку с остальным, одной кучей.
  const separate = ownFolder === null ? settings.get().downloadAlbumFolder !== false : ownFolder;
  const folder = separate ? path.join(targetDir(), safeName(title)) : targetDir();

  fs.mkdirSync(folder, { recursive: true });

  const shares = new Map();
  const total = tracks.length;
  let finished = 0;

  const tell = () => {
    let sum = 0;
    for (const value of shares.values()) sum += value;

    report({
      id: 'many',
      title,
      share: total ? sum / total : 0,
      text: `${finished} / ${total}`,
    });
  };

  const mp3 = settings.get().downloadMp3;
  const errors = [];
  let skipped = 0;
  let index = 0;

  const worker = async () => {
    while (index < tracks.length) {
      const current = tracks[index];
      index += 1;

      if (!force && alreadyHave(current, folder)) {
        skipped += 1;
        shares.set(current.id, 1);
        finished += 1;
        tell();
        continue;
      }

      try {
        await downloadTrack(current, {
          dir: folder,
          mp3,
          onProgress: (share) => {
            shares.set(current.id, share);
            tell();
          },
        });
      } catch (e) {
        errors.push(`${current.title}: ${e.message}`);
        log.warn('Трек не скачался:', current.title, e.message);
      }

      shares.set(current.id, 1);
      finished += 1;
      tell();
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL, tracks.length) }, worker));

  report({ id: 'many', title, share: 1, done: true, folder, errors: errors.length, skipped });
  log.info(`Скачано ${finished - errors.length - skipped} из ${total} (уже было: ${skipped}): ${folder}`);

  return { folder, total, failed: errors.length, skipped };
}

/** Проверка скачивания без интерфейса: номер трека задаётся переменной. */
function selfTest() {
  const id = process.env.KOTAMUSIC_DOWNLOAD_TEST;
  if (!id) return;

  setTimeout(async () => {
    try {
      if (id.startsWith('playlists:')) {
        const owner = id.slice('playlists:'.length);
        const list = await api.playlists(owner);
        log.info('Проверка: плейлисты', JSON.stringify(list.slice(0, 8)));
        return;
      }

      if (id.startsWith('playlist:')) {
        const [owner, kind] = id.slice('playlist:'.length).split(':');
        log.info('Проверка скачивания, плейлист', owner, kind);
        const { title, tracks } = await api.playlistTracks(owner, kind);
        log.info(`Проверка: в плейлисте «${title}» ${tracks.length} треков`);
        log.info('Проверка: готово', JSON.stringify(await many(tracks.slice(0, 2), title)));
        return;
      }

      if (id.startsWith('album:')) {
        const albumId = id.slice('album:'.length);
        log.info('Проверка скачивания, альбом', albumId);
        const { title, tracks } = await api.albumTracks(albumId);
        log.info(`Проверка: в альбоме «${title}» ${tracks.length} треков`);
        const result = await many(tracks.slice(0, Number(process.env.KOTAMUSIC_DOWNLOAD_LIMIT) || 2), title);
        log.info('Проверка: готово', JSON.stringify(result));
        return;
      }

      log.info('Проверка скачивания, трек', id);
      const done = await single(id, { force: true });
      log.info('Проверка: готово', done.file, fs.statSync(done.file).size, 'байт');
    } catch (e) {
      log.warn('Проверка скачивания не удалась:', e.stack || e.message);
    }
  }, 8000);
}

function start() {
  selfTest();

  // Проверка вёрстки без мыши: окно само откроет настройки звука.

  if (process.env.KOTAMUSIC_UI_TEST === 'sound') {
    // Окно клиента появляется не сразу, поэтому пробуем несколько раз.
    let left = 6;
    const timer = setInterval(() => {
      const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
      left -= 1;

      if (windows.length) {
        for (const window of windows) window.webContents.send('kotamusic:ui:sound');
        clearInterval(timer);
        return;
      }

      if (left <= 0) clearInterval(timer);
    }, 3000);
  }

  ipcMain.handle('kotamusic:download:track', async (_event, trackId, options = {}) =>
    enqueue(async () => {
      try {
        // Первое скачивание: спросим, где держать музыку.
        if (!(await ensureDir())) return { ok: false, error: 'Папка не выбрана' };

        const done = await single(trackId, options);
        if (done.exists) return { ok: false, ...done };

        return { ok: true, file: done.file };
      } catch (e) {
        log.warn('Скачивание не удалось:', e.message);
        notice.show(`Не удалось скачать трек: ${e.message}`);
        return { ok: false, error: e.message };
      }
    })
  );

  // В «Моей волне» ссылки на трек нет вовсе, поэтому туда приходят
  // название с исполнителем — трек находим сами.
  ipcMain.handle('kotamusic:download:current', async (_event, about) =>
    enqueue(async () => {
      try {
        if (!(await ensureDir())) return { ok: false, error: 'Папка не выбрана' };

        const track = await api.findTrack(about?.track || about || {});
        if (!track?.id) throw new Error('Не нашёл этот трек в Яндекс Музыке');

        const done = await single(track.id, about?.options || {});
        if (done.exists) return { ok: false, ...done };

        return { ok: true, file: done.file };
      } catch (e) {
        log.warn('Скачивание не удалось:', e.message);
        notice.show(`Не удалось скачать трек: ${e.message}`);
        return { ok: false, error: e.message };
      }
    })
  );

  ipcMain.handle('kotamusic:download:album', async (_event, albumId, options = {}) =>
    enqueue(async () => {
      try {
        if (!(await ensureDir())) return { ok: false, error: 'Папка не выбрана' };

        const { title, tracks } = await api.albumTracks(albumId);
        const result = await many(tracks, title || `Альбом ${albumId}`, options);
        return { ok: true, ...result };
      } catch (e) {
        log.warn('Альбом не скачался:', e.message);
        notice.show(`Не удалось скачать альбом: ${e.message}`);
        return { ok: false, error: e.message };
      }
    })
  );

  ipcMain.handle('kotamusic:download:playlist', async (_event, owner, kind, options = {}) =>
    enqueue(async () => {
      try {
        if (!(await ensureDir())) return { ok: false, error: 'Папка не выбрана' };

        const { title, tracks } = await api.playlistTracks(owner, kind);
        const result = await many(tracks, title || 'Плейлист', options);
        return { ok: true, ...result };
      } catch (e) {
        log.warn('Плейлист не скачался:', e.message);
        notice.show(`Не удалось скачать плейлист: ${e.message}`);
        return { ok: false, error: e.message };
      }
    })
  );

  // Качество и кодек: спрашиваем у того же API, что и ссылку на файл,
  // и держим ответ в памяти — на один трек одного запроса достаточно.
  ipcMain.handle('kotamusic:track:quality', async (_event, about) => {
    // Из панели приходит номер трека, а из «Моей волны» — название:
    // там ссылки на трек нет вовсе.
    let trackId = typeof about === 'object' ? about?.trackId : about;
    const wanted = typeof about === 'object' ? about?.quality : null;
    const key = `${trackId || (typeof about === 'object' ? `${about?.artist} — ${about?.title}` : '')}|${wanted || ''}`;
    if (key === '|') return null;
    if (quality.has(key)) return quality.get(key);

    try {
      if (!trackId) {
        const found = await api.findTrack(about || {});
        trackId = found?.id || null;
      }

      if (!trackId) return null;

      const info = await api.fileInfo(trackId, { quality: wanted });
      const codec = api.CODEC_LABEL[info?.codec] || String(info?.codec || '').toUpperCase();
      const mark = api.QUALITY_LABEL[info?.quality] || (codec === 'FLAC' ? 'HQ+' : '');
      const bitrate = Number(info?.bitrate) || 0;

      const answer = {
        label: [mark, codec].filter(Boolean).join(': '),
        title: `Качество трека: ${[mark, codec].filter(Boolean).join(': ')}${bitrate ? `, ${bitrate} кбит/с` : ''}`,
        codec: info?.codec || null,
        bitrate,
      };

      if (quality.size > 200) quality.clear();
      quality.set(key, answer);
      return answer;
    } catch (e) {
      log.debug('Качество трека узнать не вышло:', e.message);
      return null;
    }
  });

  // Разовый выбор папки: настройку не меняем, качаем один раз туда.
  ipcMain.handle('kotamusic:download:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Куда сохранить на этот раз',
      defaultPath: targetDir(),
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  });

  ipcMain.handle('kotamusic:download:folder', () => {
    shell.openPath(targetDir());
    return targetDir();
  });

  ipcMain.handle('kotamusic:download:choose-dir', async () => {
    const window = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(window, {
      title: 'Куда складывать скачанные треки',
      defaultPath: targetDir(),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths.length) return null;

    settings.set({ downloadDir: result.filePaths[0] });
    return result.filePaths[0];
  });
}

module.exports = { start, targetDir, single, many, extensionFor, safeName, fileNameFor };
