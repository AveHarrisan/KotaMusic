'use strict';
// Понятные ошибки и отчёт: без electron, с заглушками вместо него,
// настроек и журнала.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');

const LIB = path.join(__dirname, '..', 'mod', 'lib');

function load() {
  const electron = {
    app: { getVersion: () => '5.121.2', getPath: () => os.tmpdir() },
    ipcMain: { handle: () => {} },
    shell: { showItemInFolder: () => {} },
  };

  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;

    if (parent && parent.filename && parent.filename.startsWith(LIB)) {
      if (request === './settings') return { get: () => ({}) };
      if (request === './log') return { info: () => {}, warn: () => {}, error: () => {}, file: '' };
    }

    return original.call(this, request, parent, isMain);
  };

  delete require.cache[path.join(LIB, 'diagnostics.js')];
  const diagnostics = require(path.join(LIB, 'diagnostics.js'));
  Module._load = original;
  return diagnostics;
}

/** Ошибка в том виде, в каком её отдаёт fetch. */
function fetchError(url, cause) {
  const error = new TypeError('fetch failed');
  error.cause = cause;
  error.url = url;
  return error;
}

test('«fetch failed» превращается в понятный текст с адресом', () => {
  const { explain } = load();
  const url = 'https://release-assets.githubusercontent.com/x/app.asar';

  const timeout = explain(fetchError(url, Object.assign(new Error('connect'), { code: 'ETIMEDOUT' })));
  assert.match(timeout, /release-assets\.githubusercontent\.com не отвечает/);

  // Так падает Node, перебрав несколько адресов: код лежит внутри пачки.
  const aggregate = new AggregateError([Object.assign(new Error('a'), { code: 'ENETUNREACH' })]);
  assert.match(explain(fetchError(url, aggregate)), /нет маршрута до release-assets/);

  const dnsFail = explain(fetchError(url, Object.assign(new Error('dns'), { code: 'ENOTFOUND' })));
  assert.match(dnsFail, /не удаётся найти адрес/);

  const reset = explain(fetchError(url, Object.assign(new Error('r'), { code: 'ECONNRESET' })));
  assert.match(reset, /обрывается/);
});

test('ответы сервера объясняются, а не показываются кодом', () => {
  const { explain } = load();
  const error = (status) => Object.assign(new Error('x'), { status, url: 'https://github.com/a' });

  assert.match(explain(error(404)), /нет нужного файла/);
  assert.match(explain(error(403)), /ограничил запросы/);
  assert.match(explain(error(502)), /сбоит/);
});

test('адрес из hosts отмечается в тексте ошибки', () => {
  const { explain } = load();

  // localhost есть в hosts почти везде.
  const text = explain(
    fetchError('https://localhost/', Object.assign(new Error('c'), { code: 'ECONNREFUSED' }))
  );
  assert.match(text, /вписан в файл hosts/);
});

test('запрос помнит адрес, а ответ не 2xx становится ошибкой с кодом', async () => {
  const { request, explain } = load();

  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}/build-info.json`;

  try {
    await assert.rejects(request(url), (e) => e.status === 404 && e.url.startsWith(url));

    const allowed = await request(url, undefined, { allowStatus: true });
    assert.strictEqual(allowed.status, 404);
  } finally {
    server.close();
  }

  // Порт закрыт — ошибка сети с адресом внутри. Порт берём свежий:
  // к прежнему fetch держит соединение, и там будет обрыв, а не отказ.
  const spare = http.createServer();
  await new Promise((done) => spare.listen(0, '127.0.0.1', done));
  const dead = `http://127.0.0.1:${spare.address().port}/`;
  await new Promise((done) => spare.close(done));

  const closed = await request(dead).catch((e) => e);
  assert.strictEqual(closed.url, dead);
  assert.match(explain(closed), /127\.0\.0\.1 не отвечает/);
});

test('последняя ошибка запоминается для отчёта', () => {
  const { remember } = load();
  const text = remember(
    fetchError('https://github.com/x', Object.assign(new Error('t'), { code: 'UND_ERR_CONNECT_TIMEOUT' })),
    'проверка'
  );
  assert.match(text, /github\.com не отвечает/);
});

test('в отчёте имя прячется только в путях', () => {
  const { mask } = load();
  const user = os.userInfo().username;

  const text = mask(
    [
      `C:\\Users\\${user}\\Music`,
      JSON.stringify({ dir: `C:\\Users\\${user}\\Music` }),
      `/home/${user}/x`,
      `https://github.com/Ave${user}/KotaMusic`,
      'Authorization: OAuth y0_AgAAAABCDEFGHIJKLMNOP',
    ].join('\n')
  );

  assert.ok(!text.includes(`Users\\${user}`), 'имя в пути Windows осталось');
  assert.ok(!text.includes(`Users\\\\${user}`), 'имя в пути из JSON осталось');
  assert.ok(!text.includes(`home/${user}`), 'имя в пути Linux осталось');
  assert.ok(text.includes(`github.com/Ave${user}/KotaMusic`), 'адрес репозитория испорчен');
  assert.match(text, /OAuth <скрыто>/);
});
