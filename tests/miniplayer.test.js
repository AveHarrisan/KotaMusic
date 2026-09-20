'use strict';
// Проверки мини-плеера без Electron: модуль подключается с подменёнными
// electron, настройками и журналом.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

const LIB = path.join(__dirname, '..', 'mod', 'lib');

/** Собирает мини-плеер с поддельным окружением и возвращает рычаги к нему. */
function harness({ values = {}, displays } = {}) {
  const state = {
    position: [100, 100],
    size: [340, 108],
    created: 0,
    closed: 0,
    handlers: {},
    screenHandlers: {},
  };

  let config = {
    miniplayer: true,
    miniplayerPosition: { x: 2600, y: 300 },
    miniplayerCompact: false,
    miniplayerResizable: false,
    miniplayerTaskbar: false,
    miniplayerLocked: false,
    miniplayerHideIdle: false,
    miniplayerUnlockSeconds: 30,
    volumeStep: 1,
    ...values,
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

  class FakeWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = { on: () => {}, send: () => {}, setZoomFactor: () => {} };
      state.created += 1;
    }
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop(value, level) {
      state.onTop = { value, level };
    }
    isAlwaysOnTop() {
      return Boolean(state.onTop?.value);
    }
    loadFile() {}
    on(event, fn) {
      state.handlers[event] = fn;
    }
    show() {}
    getPosition() {
      return state.position;
    }
    setPosition(x, y) {
      state.position = [x, y];
    }
    getSize() {
      return state.size;
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    setOpacity() {}
    close() {
      state.closed += 1;
      this.destroyed = true;
      state.handlers.close?.();
      state.handlers.closed?.();
    }
    isDestroyed() {
      return this.destroyed;
    }
  }

  const all = displays || [
    { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { workArea: { x: 1920, y: 0, width: 2560, height: 1440 } },
  ];

  const ready = { value: true, waiting: [] };

  const electron = {
    app: {
      isReady: () => ready.value,
      once: (event, fn) => event === 'ready' && ready.waiting.push(fn),
      getPath: () => '/tmp',
    },
    BrowserWindow: FakeWindow,
    ipcMain: { on: () => {} },
    get screen() {
      // Electron до готовности приложения бросает здесь ошибку — ведём
      // себя так же, иначе проверка пропустит настоящую поломку.
      if (!ready.value) throw new Error("The 'screen' module can't be used before the app 'ready' event");

      return {
        getAllDisplays: () => all.current || all,
        getPrimaryDisplay: () => (all.current || all)[0],
        on: (event, fn) => {
          state.screenHandlers[event] = fn;
        },
      };
    },
  };

  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;

    if (parent && parent.filename && parent.filename.startsWith(LIB)) {
      if (request === './settings') return settings;
      if (request === './log') return { info: () => {}, warn: () => {}, debug: () => {} };
      if (request === './player') return { perform: () => {}, setPlaying: () => {} };
    }

    return original.call(this, request, parent, isMain);
  };

  delete require.cache[path.join(LIB, 'miniplayer.js')];
  const miniplayer = require(path.join(LIB, 'miniplayer.js'));
  Module._load = original;

  return {
    miniplayer,
    state,
    settings,
    config: () => config,
    displays: all,
    ready,
  };
}

test('место окна запоминается, когда его двигает человек', () => {
  const { miniplayer, state, config } = harness();

  miniplayer.start();
  miniplayer.show();

  state.position = [2700, 400];
  state.handlers.moved();

  assert.deepStrictEqual(config().miniplayerPosition, { x: 2700, y: 400 });
});

test('перестановка экранов не затирает место окна', () => {
  const { miniplayer, state, config } = harness();

  miniplayer.start();
  miniplayer.show();

  // Монитор выключился: Windows сама сгоняет окно на оставшийся экран.
  state.screenHandlers['display-removed']();
  state.position = [300, 200];
  state.handlers.moved();

  assert.deepStrictEqual(
    config().miniplayerPosition,
    { x: 2600, y: 300 },
    'место, выбранное человеком, потеряно'
  );
});

test('окно возвращается на своё место, когда экраны вернулись', async () => {
  const { miniplayer, state } = harness();

  miniplayer.start();
  miniplayer.show();

  state.screenHandlers['display-removed']();
  state.position = [300, 200];

  state.screenHandlers['display-added']();
  await new Promise((done) => setTimeout(done, 3000));

  assert.deepStrictEqual(state.position, [2600, 300], 'окно не вернулось на место');
});

test('на место, которого больше нет, окно не возвращаем', async () => {
  const only = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const { miniplayer, state } = harness({ displays: only });

  miniplayer.start();
  miniplayer.show();

  state.position = [300, 200];
  state.screenHandlers['display-metrics-changed']();
  await new Promise((done) => setTimeout(done, 3000));

  assert.deepStrictEqual(state.position, [300, 200], 'окно уехало за пределы экрана');
});

test('до готовности приложения экраны не трогаем', () => {
  const { miniplayer, state, ready } = harness();
  ready.value = false;

  // Раньше здесь падал весь мод: всё, что подключается после мини-плеера,
  // не запускалось вовсе.
  assert.doesNotThrow(() => miniplayer.start());
  assert.deepStrictEqual(state.screenHandlers, {}, 'подписались раньше времени');

  ready.value = true;
  ready.waiting.forEach((fn) => fn());

  assert.ok(state.screenHandlers['display-added'], 'после готовности не подписались');
});

test('мини-плеер поднимается наверх уровнем, который работает на Windows', () => {
  const { miniplayer, state } = harness({ values: { miniplayerOnTop: true } });

  miniplayer.start();
  miniplayer.show();

  // ⚠️Уровень по умолчанию в нынешнем Electron на Windows молча не
  // применяется, поэтому просим именно «screen-saver».
  assert.deepStrictEqual(state.onTop, { value: true, level: 'screen-saver' });
});

test('с выключенной настройкой окно остаётся обычным', () => {
  const { miniplayer, state } = harness({ values: { miniplayerOnTop: false } });

  miniplayer.start();
  miniplayer.show();

  assert.strictEqual(state.onTop.value, false);
});
