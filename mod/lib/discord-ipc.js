'use strict';
// Минимальный клиент Discord IPC. Библиотеки не берём: протокол — это
// локальный сокет и кадры вида [опкод][длина][JSON], а лишняя зависимость
// внутри архива клиента означала бы лишний источник поломок.

const net = require('net');
const { randomUUID } = require('crypto');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

/** Пути, по которым Discord слушает локальные подключения. */
function socketPaths() {
  if (process.platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }

  const base =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    process.env.TEMP ||
    os.tmpdir();

  // Discord из Flatpak и Snap кладёт сокет в свою подпапку.
  const dirs = ['', 'app/com.discordapp.Discord/', 'snap.discord/'];
  const paths = [];
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) paths.push(path.join(base, dir, `discord-ipc-${i}`));
  }
  return paths;
}

function encode(op, payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(data.length, 4);
  return Buffer.concat([head, data]);
}

class DiscordIPC extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.socket = null;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
  }

  /** Перебирает сокеты, пока какой-нибудь не ответит. */
  async connect() {
    for (const candidate of socketPaths()) {
      try {
        await this.#tryPath(candidate);
        return true;
      } catch {
        // следующий
      }
    }
    throw new Error('Discord не найден: ни один сокет не отвечает');
  }

  #tryPath(socketPath) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      const fail = (e) => {
        socket.destroy();
        reject(e);
      };

      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        this.socket = socket;

        socket.on('data', (chunk) => this.#onData(chunk));
        socket.on('close', () => {
          this.connected = false;
          this.emit('close');
        });
        socket.on('error', (e) => this.emit('error', e));

        this.once('ready', () => resolve());
        this.once('handshake-error', reject);
        socket.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
      });
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) break;

      const payload = JSON.parse(this.buffer.subarray(8, 8 + len).toString('utf8'));
      this.buffer = this.buffer.subarray(8 + len);

      if (op === OP.PING) {
        this.socket.write(encode(OP.PONG, payload));
        continue;
      }
      if (op === OP.CLOSE) {
        this.emit('handshake-error', new Error(payload.message || 'Discord закрыл соединение'));
        this.socket.destroy();
        continue;
      }
      if (payload.cmd === 'DISPATCH' && payload.evt === 'READY') {
        this.connected = true;
        this.emit('ready', payload.data);
        continue;
      }
      this.emit('message', payload);
    }
  }

  setActivity(activity) {
    if (!this.connected) return false;
    this.socket.write(
      encode(OP.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        // Discord ждёт идентификатор запроса именно в формате UUID.
        nonce: randomUUID(),
      })
    );
    return true;
  }

  clearActivity() {
    if (!this.connected) return false;
    this.socket.write(
      encode(OP.FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid },
        nonce: randomUUID(),
      })
    );
    return true;
  }

  destroy() {
    this.connected = false;
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }
}

module.exports = { DiscordIPC };
