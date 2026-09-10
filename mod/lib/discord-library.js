'use strict';
// Библиотека старого мода, приведённая к тому же интерфейсу, что и наш
// клиент. Держим рядом, пока сравниваем поведение двух способов отправки.
//
// Библиотека рассчитывает на живое соединение и без него пишет в пустой
// сокет, роняя необработанное исключение прямо в клиент. Поэтому каждый
// вызов закрыт проверкой и перехватом.

const { Client } = require('../vendor/discord-rpc');

/** Показывает в журнале то, что библиотека реально пишет в сокет. */
function watchFrames(client, log) {
  const socket = client.transport?.socket;
  if (!socket || socket.__kotamusicWatched) return;

  socket.__kotamusicWatched = true;
  const original = socket.write.bind(socket);

  socket.write = (chunk, ...rest) => {
    try {
      if (Buffer.isBuffer(chunk) && chunk.length >= 8) {
        const op = chunk.readInt32LE(0);
        const body = chunk.subarray(8, 8 + chunk.readInt32LE(4)).toString('utf8');
        log.debug(`Кадр библиотеки op=${op}:`, body.slice(0, 500));
      }
    } catch {}

    return original(chunk, ...rest);
  };
}

function libraryClient(clientId, log) {
  const client = new Client({ transport: 'ipc' });

  const wrapper = {
    connected: false,

    on: (event, handler) => client.on(event, handler),

    connect: async () => {
      await client.connect(clientId);
      wrapper.connected = true;
      watchFrames(client, log);
    },

    setActivity: (activity) => {
      if (!wrapper.connected) return false;

      try {
        client
          .setActivity({
            type: activity.type,
            statusDisplayType: activity.status_display_type,
            details: activity.details,
            detailsUrl: activity.details_url,
            state: activity.state,
            stateUrl: activity.state_url,
            largeImageKey: activity.assets?.large_image,
            largeImageText: activity.assets?.large_text,
            smallImageText: activity.assets?.small_text,
            startTimestamp: activity.timestamps?.start,
            endTimestamp: activity.timestamps?.end,
            buttons: activity.buttons,
            instance: activity.instance,
          })
          ?.catch?.((e) => log.warn('Библиотека не приняла статус:', e.message));
      } catch (e) {
        log.warn('Библиотека не смогла отправить статус:', e.message);
        return false;
      }

      return true;
    },

    clearActivity: () => {
      if (!wrapper.connected) return;
      try {
        client.clearActivity()?.catch?.(() => {});
      } catch {}
    },

    destroy: () => {
      wrapper.connected = false;
      try {
        client.destroy()?.catch?.(() => {});
      } catch {}
    },
  };

  return wrapper;
}

module.exports = { libraryClient };
