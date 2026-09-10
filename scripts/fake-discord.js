'use strict';
// Заглушка Discord: слушает тот же сокет и записывает всё, что приходит.
// Нужна, чтобы сравнивать способы отправки без установленного Discord.
//
//   node scripts/fake-discord.js <файл-отчёта>

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const OUT = process.argv[2] || '/tmp/fake-discord.jsonl';
const SOCKET = path.join(
  process.env.XDG_RUNTIME_DIR || os.tmpdir(),
  'discord-ipc-0'
);

function encode(op, payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}

fs.rmSync(SOCKET, { force: true });
fs.writeFileSync(OUT, '');

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0);
      const length = buffer.readInt32LE(4);
      if (buffer.length < 8 + length) break;

      const body = buffer.subarray(8, 8 + length).toString('utf8');
      buffer = buffer.subarray(8 + length);

      fs.appendFileSync(OUT, JSON.stringify({ op, body: JSON.parse(body) }) + '\n');

      if (op === 0) {
        // Рукопожатие: отвечаем так же, как настоящий Discord.
        socket.write(
          encode(1, {
            cmd: 'DISPATCH',
            evt: 'READY',
            data: {
              v: 1,
              config: { cdn_host: 'cdn.discordapp.com', api_endpoint: '//discord.com/api', environment: 'production' },
              user: { id: '1', username: 'tester', discriminator: '0', avatar: null },
            },
          })
        );
        continue;
      }

      if (op === 1) {
        const request = JSON.parse(body);
        socket.write(
          encode(1, {
            cmd: request.cmd,
            data: request.args?.activity ?? null,
            evt: null,
            nonce: request.nonce,
          })
        );
      }
    }
  });
});

server.listen(SOCKET, () => console.log('Заглушка Discord слушает', SOCKET));
