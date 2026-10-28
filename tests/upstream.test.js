'use strict';
// Повторы запросов к раздаче Яндекса: разовый сбой сети не должен
// ронять автосборку и заводить задачу «врезки не легли».

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { fetchRetry } = require('../scripts/lib/upstream');

/** Локальный сервер, отвечающий по очереди заданными кодами. */
async function serve(codes) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    const code = codes[Math.min(hits++, codes.length - 1)];
    res.writeHead(code).end(code === 200 ? 'version: 1.0.0' : '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/latest.yml`;
  return { url, hits: () => hits, close: () => server.close() };
}

const fast = { pause: [0], read: (res) => res.text() };

test('после 503 повторяет и получает ответ', async () => {
  const s = await serve([503, 502, 200]);
  try {
    assert.strictEqual(await fetchRetry(s.url, fast), 'version: 1.0.0');
    assert.strictEqual(s.hits(), 3);
  } finally {
    s.close();
  }
});

test('404 не повторяет', async () => {
  const s = await serve([404]);
  try {
    await assert.rejects(fetchRetry(s.url, fast), /HTTP 404/);
    assert.strictEqual(s.hits(), 1);
  } finally {
    s.close();
  }
});

test('после всех попыток — ошибка сети с кодом NETWORK', async () => {
  const s = await serve([500]);
  try {
    await assert.rejects(fetchRetry(s.url, { ...fast, tries: 3 }), (err) => {
      assert.strictEqual(err.code, 'NETWORK');
      assert.match(err.message, /Сбой сети до раздачи Яндекса/);
      return true;
    });
    assert.strictEqual(s.hits(), 3);
  } finally {
    s.close();
  }
});

test('недоступный адрес — тоже ошибка сети', async () => {
  await assert.rejects(
    fetchRetry('http://127.0.0.1:1/latest.yml', { ...fast, tries: 2 }),
    (err) => err.code === 'NETWORK'
  );
});
