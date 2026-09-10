'use strict';
// Библиотека старого мода, приведённая к тому же интерфейсу, что и наш
// клиент. Держим рядом, пока сравниваем поведение: у неё статус
// рассылается другим, у нашего клиента — пока нет.

const { Client } = require('../vendor/discord-rpc');

function libraryClient(clientId, log) {
  const client = new Client({ transport: 'ipc' });

  const wrapper = {
    connected: false,
    on: (event, handler) => client.on(event, handler),
    connect: async () => {
      await client.connect(clientId);
      wrapper.connected = true;

      // Сверяем не наши намерения, а то, что библиотека реально пишет в сокет.
      const socket = client.transport?.socket;
      if (socket && !socket.__kotamusicWatched) {
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
    },
    setActivity: (activity) => {
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
        .catch((e) => log.warn('Библиотека не приняла статус:', e.message));
      return true;
    },
    clearActivity: () => client.clearActivity().catch(() => {}),
    destroy: () => {
      wrapper.connected = false;
      try {
        client.destroy();
      } catch {}
    },
  };

  return wrapper;
}

module.exports = { libraryClient };
