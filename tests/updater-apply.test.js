'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

async function run(blocks) {
  const files = new Map([['source', 'new-asar'], ['target', 'old-asar'], ['client.exe', 'old-exe']]);
  const logs = [];
  const launches = [];
  let attempts = 0;
  const fakeFs = {
    appendFileSync: (_, line) => logs.push(line),
    copyFileSync(from, to) {
      if (to === 'client.exe' && from.includes('.kotamusic-') && attempts++ < blocks) {
        throw new Error('EBUSY');
      }
      assert.ok(files.has(from), from);
      files.set(to, files.get(from));
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../mod/updater/apply.js'), 'utf8'), {
    require(name) {
      if (name === './fs') return fakeFs;
      if (name === './integrity') return { patchIntegrity(file, archive) {
        assert.equal(files.get(archive), 'new-asar');
        const patched = files.get(file) !== 'new-exe';
        files.set(file, 'new-exe');
        return { patched };
      } };
      if (name === 'child_process') return { spawn: (...args) => {
        launches.push(args); return { unref() {} };
      } };
      return require(name);
    },
    process: { argv: ['node', 'apply.js', 'source', 'target', 'client.exe', 'client.exe', '0'],
      platform: 'win32', env: { ELECTRON_RUN_AS_NODE: '1' } },
    setTimeout: (fn) => setImmediate(fn),
  });
  for (let i = 0; i < 100; i++) await new Promise(setImmediate);
  return { files, logs: logs.join(''), launches, attempts };
}

test('временная блокировка exe: повторы, целостность и запуск без Node-режима', async () => {
  const result = await run(2);
  assert.equal(result.attempts, 3);
  assert.equal(result.files.get('target'), 'new-asar');
  assert.equal(result.files.get('client.exe'), 'new-exe');
  assert.equal(result.launches.length, 1);
  assert.equal(result.launches[0][2].env.ELECTRON_RUN_AS_NODE, undefined);
  assert.match(result.logs, /готово, запускаю клиент/);
});

test('длительная блокировка: возвращаются согласованные exe и архив', async () => {
  const result = await run(Infinity);
  assert.equal(result.attempts, 30);
  assert.equal(result.files.get('target'), 'old-asar');
  assert.equal(result.files.get('client.exe'), 'old-exe');
  assert.equal(result.launches.length, 0);
  assert.match(result.logs, /Не удалось заменить файл целостности/);
});
