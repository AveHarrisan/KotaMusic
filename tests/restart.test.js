'use strict';
// Проверки предложения перезапустить клиент: диалог показывается там, где
// настройка без перезапуска не работает, и нигде больше.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

const LIB = path.join(__dirname, '..', 'mod', 'lib');

function harness({ answer = 0 } = {}) {
  const calls = { dialogs: [], relaunch: 0, exit: 0 };

  let config = {
    ynisonRemote: false,
    hardwareAcceleration: true,
    startupPage: '',
    closeToTray: false,
  };

  const listeners = [];

  const settings = {
    get: () => config,
    set: (patch) => {
      const before = { ...config };
      config = { ...config, ...patch };
      listeners.forEach((fn) => fn(config, before));
    },
    onChange: (fn) => listeners.push(fn),
  };

  const electron = {
    app: {
      relaunch: () => (calls.relaunch += 1),
      exit: () => (calls.exit += 1),
    },
    dialog: {
      showMessageBox: async (_window, options) => {
        calls.dialogs.push(options.detail);
        return { response: answer };
      },
    },
    BrowserWindow: { getAllWindows: () => [] },
  };

  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;

    if (parent && parent.filename && parent.filename.startsWith(LIB)) {
      if (request === './settings') return settings;
      if (request === './log') return { info: () => {}, warn: () => {} };
    }

    return original.call(this, request, parent, isMain);
  };

  delete require.cache[path.join(LIB, 'restart.js')];
  const restart = require(path.join(LIB, 'restart.js'));
  Module._load = original;

  restart.start();
  return { settings, calls };
}

const settle = () => new Promise((done) => setTimeout(done, 50));

test('про управление с других устройств спрашиваем и перезапускаем', async () => {
  const { settings, calls } = harness({ answer: 0 });

  settings.set({ ynisonRemote: true });
  await settle();

  assert.strictEqual(calls.dialogs.length, 1, 'диалога не было');
  assert.match(calls.dialogs[0], /Управление этим компьютером с других устройств/);
  assert.strictEqual(calls.relaunch, 1, 'клиент не перезапустился');
  assert.strictEqual(calls.exit, 1);
});

test('ответ «Позже» ничего не перезапускает', async () => {
  const { settings, calls } = harness({ answer: 1 });

  settings.set({ hardwareAcceleration: false });
  await settle();

  assert.strictEqual(calls.dialogs.length, 1);
  assert.strictEqual(calls.relaunch, 0, 'клиент перезапустился без спроса');
});

test('настройки, работающие сразу, о перезапуске не спрашивают', async () => {
  const { settings, calls } = harness();

  settings.set({ closeToTray: true });
  await settle();

  assert.strictEqual(calls.dialogs.length, 0, 'спросили о перезапуске впустую');
});

test('пустая стартовая страница перезапуска не требует', async () => {
  const { settings, calls } = harness();

  settings.set({ startupPage: '' });
  await settle();
  assert.strictEqual(calls.dialogs.length, 0);

  settings.set({ startupPage: '/collection' });
  await settle();
  assert.strictEqual(calls.dialogs.length, 1, 'про выбранную страницу не спросили');
});
