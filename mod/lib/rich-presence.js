'use strict';
// Discord Rich Presence: показывает в профиле, что играет в Яндекс Музыке.

const { app, ipcMain } = require('electron');

const { DiscordIPC } = require('./discord-ipc');
const branding = require('../branding');
const album = require('./album');
const settings = require('./settings');
const tweaks = require('./tweaks');
const taskbar = require('./taskbar');
const miniplayer = require('./miniplayer');
const log = require('./log');

const TRACK_CHANNEL = 'kotamusic:player:track';

const RECONNECT_DELAY_MS = 15000;
const TIME_REFRESH_MS = 10000; // как часто переписываем время в строке исполнителя
const MIN_INTERVAL_MS = 2000; // Discord ограничивает частоту обновлений
const SEEK_TOLERANCE_S = 3; // расхождение, после которого считаем это перемоткой
const CLEAR_GRACE_MS = 6000; // на стыке треков плеер на миг «не играет»
const WEB_BASE = 'https://music.yandex.ru';

let rpc = null;
let reconnectTimer = null;
let updateTimer = null;
let lastSentAt = 0;
let tickState = null; // свежая позиция: { title, position, duration, at }
let albumTitle = null;
let clearTimer = null;

let track = null;
let lastSent = '';
// Часть полей поддерживают не все версии Discord: если он ругается,
// переходим на упрощённый вид и больше не пробуем.
let simplify = false;

/** Активность без необязательных полей. */
function basic(activity) {
  const { status_display_type, details_url, state_url, buttons, ...rest } = activity;
  return rest;
}

function webUrl(relative) {
  if (!relative) return undefined;
  return relative.startsWith('http') ? relative : WEB_BASE + relative;
}

// Discord считает длину подписи кнопки в байтах, а кириллица весит по два.
// Слишком длинная подпись делает статус недоступным для рассылки: свой
// клиент его рисует, другие участники не видят ничего.
const BUTTON_LABEL_LIMIT = 32;

/** «0:37» — для строки, которую видно при наведении в канале. */
function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function label(text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= BUTTON_LABEL_LIMIT) return text;

  log.warn(`Подпись кнопки «${text}» длиннее ${BUTTON_LABEL_LIMIT} байт (${bytes}), обрезаю`);

  let cut = text;
  while (Buffer.byteLength(cut, 'utf8') > BUTTON_LABEL_LIMIT) cut = cut.slice(0, -1);
  return cut;
}

/** Состояние плеера → активность в Discord. */
function buildActivity() {
  if (!settings.get().richPresence) return null;
  if (!track || !track.isPlaying) return null;

  const artists = track.artists?.length ? track.artists.join(', ') : 'Неизвестный исполнитель';

  const activity = {
    type: 2, // Listening — «слушает», а не «играет»
    details: track.title.slice(0, 128),
    state: artists.slice(0, 128),
    instance: false,
    assets: {
      large_image: track.cover || 'logo',
      // Третьей строкой Discord показывает это поле — там уместен альбом.
      large_text: (settings.get().showAlbum && albumTitle) || 'Яндекс Музыка',
      small_text: `${branding.name} ${branding.version}`,
    },
  };

  // Полоса прогресса в Discord задаётся началом и концом трека.
  // Берём самую свежую позицию и учитываем, сколько она пролежала,
  // иначе полоса навсегда остаётся позади плеера.
  const fresh = tickState?.title === track.title ? tickState : null;
  const duration = fresh?.duration ?? track.duration;

  let position = track.position;
  if (fresh) position = fresh.position + (Date.now() - fresh.at) / 1000;

  // В компактной карточке канала Discord время не показывает вовсе:
  // полосу он рисует только в профиле. Поэтому по желанию дописываем
  // секунды прямо в строку исполнителя — её видно при наведении.
  if (settings.get().timeInState && Number.isFinite(position)) {
    const suffix = Number.isFinite(duration) && duration > 0
      ? ` · ${clock(position)} / ${clock(duration)}`
      : ` · ${clock(position)}`;

    activity.state = (artists + suffix).slice(0, 128);
  }

  if (Number.isFinite(position)) {
    const now = Date.now();
    const start = Math.round(now - position * 1000);

    if (settings.get().progress === 'counter') {
      // Только начало — Discord показывает счётчик прошедшего времени.
      activity.timestamps = { start };
    } else if (Number.isFinite(duration) && duration > 0) {
      activity.timestamps = {
        start,
        end: Math.round(now + (duration - position) * 1000),
      };
    }
  }

  if (settings.get().showTrackInMemberList) {
    // В списке участников Discord по умолчанию показывает название
    // приложения; 2 означает «показывать details», то есть трек.
    activity.status_display_type = 2;

    // Делает названия кликабельными — как у Spotify.
    if (track.trackUrl) activity.details_url = track.trackUrl;
    if (track.artistUrl) activity.state_url = track.artistUrl;
  }

  if (settings.get().showButtons) {
    // Кнопок разрешено две. Исполнитель и так кликается в строке статуса,
    // поэтому вторую отдаём автору мода.
    const buttons = [];

    // В режиме «Моей волны» ссылки на трек нет — тогда ведём к исполнителю.
    const listenUrl = track.trackUrl || track.artistUrl;
    if (listenUrl) buttons.push({ label: label('Слушать'), url: listenUrl });
    if (branding.authorUrl) buttons.push({ label: label('Harrisan'), url: branding.authorUrl });

    if (buttons.length) activity.buttons = buttons;
  }

  return activity;
}

function sync() {
  if (!rpc?.connected) return;

  const activity = buildActivity();

  // Между треками плеер на мгновение перестаёт «играть». Снимать статус
  // сразу нельзя — он будет мигать на каждом переходе. Ждём выдержку
  // и снимаем, только если музыка так и не возобновилась.
  if (!activity) {
    if (clearTimer) return;
    clearTimer = setTimeout(() => {
      clearTimer = null;
      if (buildActivity()) return sync(); // музыка вернулась
      if (lastSent === 'null') return;

      lastSent = 'null';
      lastSentAt = Date.now();
      rpc.clearActivity();
      log.info('Статус снят');
    }, CLEAR_GRACE_MS);
    return;
  }

  clearTimeout(clearTimer);
  clearTimer = null;

  const { timestamps, ...comparable } = activity;
  const snapshot = JSON.stringify(comparable);
  if (snapshot === lastSent) return;

  lastSent = snapshot;
  lastSentAt = Date.now();

  const payload = simplify ? basic(activity) : activity;
  log.debug('Отправлено в Discord:', JSON.stringify(payload));

  // Discord мог закрыться или перезапуститься — тогда отправка не удастся
  // и надо подключаться заново, а не писать в пустоту дальше.
  if (!rpc.setActivity(payload)) {
    log.warn('Статус не отправлен, переподключаюсь');
    lastSent = '';
    scheduleReconnect();
  }
}

/**
 * Отправляет сразу, если с прошлой отправки прошло достаточно времени,
 * иначе откладывает ровно на остаток — чтобы пауза и смена трека
 * отражались мгновенно, а частые изменения не били по ограничениям.
 */
function scheduleSync() {
  if (updateTimer) return;

  const waited = Date.now() - lastSentAt;
  if (waited >= MIN_INTERVAL_MS) return sync();

  updateTimer = setTimeout(() => {
    updateTimer = null;
    sync();
  }, MIN_INTERVAL_MS - waited);
}

function scheduleReconnect() {
  if (reconnectTimer || rpc?.connected) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

async function connect() {
  const clientId = settings.get().discordApplicationId;
  if (!clientId) return log.warn('Rich Presence выключен: не задан идентификатор приложения');

  // Прошлое соединение закрываем до создания нового: иначе Discord
  // увидит два статуса сразу — по одному на каждый живой сокет.
  const previous = rpc;
  rpc = null;
  previous?.destroy();

  const client = new DiscordIPC(clientId, (op, payload) =>
    log.debug(`Кадр op=${op}:`, JSON.stringify(payload).slice(0, 500))
  );
  rpc = client;
  client.on('close', () => {
    // Закрытие уже заменённого соединения нас не касается: иначе на каждую
    // смену настроек заводился бы лишний клиент, и к Discord подключалось
    // сразу несколько наших соединений.
    if (rpc !== client) return;

    log.info('Соединение с Discord закрыто');
    lastSent = '';
    scheduleReconnect();
  });
  client.on('error', (e) => rpc === client && log.warn('Ошибка Discord:', e.message));
  client.on('message', (payload) => {
    if (rpc !== client) return;

    log.debug('Ответ Discord:', JSON.stringify(payload).slice(0, 400));
    if (payload.evt !== 'ERROR') return;

    log.warn('Discord отклонил статус:', JSON.stringify(payload.data));
    if (!simplify) {
      simplify = true;
      lastSent = '';
      log.info('Повторяю в упрощённом виде');
      sync();
    }
  });

  try {
    await client.connect();
    log.info(`Discord подключён; приложение ${clientId}`);
    lastSent = '';
    sync();
  } catch (e) {
    log.info('Discord недоступен:', e.message);
    client.destroy();
    if (rpc === client) rpc = null;
    scheduleReconnect();
  }
}

function start() {
  // Время в строке исполнителя живёт только пока его переписывают.
  // Шаг в 10 секунд оставляет двойной запас до ограничения Discord
  // (примерно пять обновлений за двадцать секунд).
  setInterval(() => {
    if (!settings.get().timeInState) return;
    if (!track?.isPlaying) return;

    lastSent = '';
    sync();
  }, TIME_REFRESH_MS);


  log.setVerbose(settings.get().debug);
  settings.onChange((now) => log.setVerbose(now.debug));

  ipcMain.on('kotamusic:debug:probe', (_event, info) => {
    log.debug('Нажатие:', JSON.stringify(info));
  });

  ipcMain.on('kotamusic:debug:dom', (_event, html) => {
    if (!settings.get().debug) return;
    try {
      require('fs').writeFileSync(
        require('path').join(require('os').tmpdir(), 'kotamusic-nolinks.html'),
        html
      );
      log.info('Разметка панели без ссылок сохранена');
    } catch (e) {
      log.warn('Не удалось сохранить разметку:', e.message);
    }
  });

  ipcMain.on('kotamusic:player:tick', (_event, data) => {
    if (!data?.title) return;

    // Позицию из сравнения исключаем — иначе статус дёргался бы ежесекундно.
    // Но если она скакнула сильнее, чем прошло времени, значит перемотка,
    // и полосу в Discord надо пересобрать.
    const previous = tickState;
    tickState = { ...data, at: Date.now() };
    miniplayer.setPosition(data);

    if (previous?.title !== data.title) return;

    const expected = previous.position + (tickState.at - previous.at) / 1000;
    if (Math.abs(data.position - expected) > SEEK_TOLERANCE_S) {
      log.info(`Перемотка: ${Math.round(expected)} → ${Math.round(data.position)} с`);
      lastSent = ''; // содержимое не изменилось, поэтому снимаем защиту от повтора
      scheduleSync();
    }
  });

  ipcMain.on(TRACK_CHANNEL, (_event, state) => {
    const before = track;
    track = state;

    const changed =
      before?.title !== state?.title ||
      before?.isPlaying !== state?.isPlaying ||
      JSON.stringify(before?.artists) !== JSON.stringify(state?.artists);

    // Позиция прошлого трека к новому не относится — иначе полоса
    // покажет чужое время, а проверка перемотки ложно сработает.
    tweaks.applySleepBlock(Boolean(state?.isPlaying));
    taskbar.setPlaying(Boolean(state?.isPlaying));
    require('./player').setPlaying(state?.isPlaying);
    miniplayer.setTrack(state);

    if (before?.title !== state?.title) {
      tickState = null;
      albumTitle = null;

      if (state?.trackUrl) {
        album.titleFor(state.trackUrl).then((title) => {
          if (track?.trackUrl !== state.trackUrl || !title) return;
          albumTitle = title;
          lastSent = ''; // строка изменилась — надо переотправить
          scheduleSync();
        });
      }
    }

    if (changed) {
      log.info(
        state
          ? `Трек: ${state.title} — ${(state.artists || []).join(', ')} ` +
              `[кнопка ${state.control}] ` +
              `(${state.isPlaying ? 'играет' : 'пауза'}, ` +
              `${state.position ?? '?'}/${state.duration ?? '?'} с)`
          : 'Плеер пуст'
      );
      scheduleSync();
    }
  });

  // При выходе статус надо снять, иначе он висит после закрытия клиента.
  const shutdown = () => {
    if (!rpc?.connected) return;
    log.info('Клиент закрывается, снимаю статус');
    rpc.clearActivity();
    // Даём сокету мгновение отправить сообщение до разрыва.
    const until = Date.now() + 200;
    while (Date.now() < until) {}
    rpc.destroy();
  };

  app.on('before-quit', shutdown);
  app.on('will-quit', shutdown);
  process.on('exit', shutdown);

  // Переключатели в настройках должны действовать сразу.
  settings.onChange((now, before) => {
    if (now.discordApplicationId !== before.discordApplicationId) {
      log.info('Меняю способ отправки, переподключаюсь');

      const previous = rpc;
      rpc = null;
      previous?.destroy();

      lastSent = '';
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connect();
      return;
    }

    lastSent = ''; // содержимое статуса могло измениться при тех же данных
    scheduleSync();
  });

  connect();
}

module.exports = { start };
