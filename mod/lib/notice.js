'use strict';
// Короткие сообщения мода человеку — в окне клиента.
//
// Главная тонкость: мод запускается раньше окна, и самые интересные
// сообщения (что-то не включилось при старте) рождаются, когда показать
// их ещё некуда. Поэтому такие откладываем, а окно, загрузившись, само
// спрашивает, нет ли для него отложенного: толкать бесполезно — клиент
// при запуске меняет страницу и стирает всё, что мы показали раньше.

const { app, BrowserWindow, ipcMain } = require('electron');

const branding = require('../branding');
const log = require('./log');

const CHANNEL = 'kotamusic:notice';
const PULL = 'kotamusic:notice:pull';
const ACTION = 'kotamusic:notice:action';
const SHOWN = 'kotamusic:notice:shown';

// Сколько отложенное сообщение ждёт своего окна: клиент при запуске
// успевает сменить страницу, а на медленной машине — и не раз.
const KEEP_MS = 30000;

const waiting = [];
let serving = false;

/** Окна клиента: свои окна мода сообщения не показывают. */
const clientWindows = () =>
  BrowserWindow.getAllWindows().filter(
    (window) => !window.isDestroyed() && window.getTitle?.() !== branding.name
  );

function deliver(window, notice) {
  if (window.isDestroyed()) return;

  // Страница ещё грузится — сообщение пропало бы впустую.
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => deliver(window, notice));
    return;
  }

  window.webContents.send(CHANNEL, notice);
}

/**
 * Окно само спрашивает, нет ли для него сообщений. Толкать бесполезно:
 * при запуске клиент успевает сменить страницу, и всё, что мы показали
 * раньше, стирается вместе с прошлой.
 */
function serve() {
  if (serving) return;
  serving = true;

  ipcMain.on(ACTION, (_event, section) => section && openSettings(section));

  ipcMain.on(SHOWN, (_event, text) => log.info('Сообщение показано в окне:', text));

  // Клиент при запуске несколько раз меняет страницу. Каждой новой
  // отдаём то, что ещё живо: иначе сообщение исчезает вместе с той
  // страницей, которая успела его забрать.
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', () => {
      const now = Date.now();
      const fresh = waiting.filter((item) => item.until > now);
      if (!fresh.length || window.getTitle?.() === branding.name) return;

      for (const item of fresh) window.webContents.send(CHANNEL, item.notice);
    });
  });

  ipcMain.on(PULL, (event) => {
    // Отдаём и не вычёркиваем: при запуске клиент меняет страницу
    // несколько раз, и спросить успевает та, что вот-вот исчезнет.
    // Поэтому сообщение живёт заданное время и достаётся каждой.
    const now = Date.now();
    const fresh = waiting.filter((item) => item.until > now);

    waiting.length = 0;
    waiting.push(...fresh);

    if (!fresh.length) return;

    for (const item of fresh) event.sender.send(CHANNEL, item.notice);
    log.info(`Окно забрало отложенные сообщения (${fresh.length})`);
  });
}

/**
 * Щелчок по сообщению ведёт туда, где неполадку можно исправить:
 * открываем настройки клиента и раскрываем нужный раздел мода.
 */
function openSettings(section) {
  for (const window of clientWindows()) {
    window.webContents.send('desktop:navigation:open-deeplink', '/settings');
    window.webContents.send('kotamusic:settings:section', section);
  }

  log.info('По сообщению открыт раздел настроек:', section);
}

function show(text, { kind = 'error', section = null } = {}) {
  const notice = { text, kind, section };
  const windows = clientWindows();

  if (!windows.length) {
    waiting.push({ notice, until: Date.now() + KEEP_MS });
    serve();
    log.info('Сообщение отложено до готовности окна:', text);
    return;
  }

  for (const window of windows) deliver(window, notice);
  log.info(`Сообщение в окно клиента (${windows.length}):`, text);
}

module.exports = { show };
