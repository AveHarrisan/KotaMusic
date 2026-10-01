'use strict';
// Ярлыки на страницы клиента.
//
// Если перетащить ссылку из окна клиента (исполнителя, альбом, плейлист)
// на рабочий стол, Windows создаёт ярлык с внутренним адресом страницы:
// music-application://desktop/artist?artistId=… Сам клиент снаружи
// понимает только yandexmusic://, а схему music-application в системе
// не регистрирует, поэтому такой ярлык не открывался вовсе: «Протокол
// "music-application" не содержит зарегистрированной программы».
//
// Регистрируем эту схему за клиентом и переводим её адреса в
// yandexmusic:// до того, как их увидит клиент: он берёт ссылку из
// последнего аргумента командной строки — при запуске из process.argv,
// а у уже открытого клиента из события second-instance.

const { app } = require('electron');

const log = require('./log');

const SCHEME = 'music-application';
const INTERNAL_PREFIX = /^music-application:\/\/desktop\/+/i;

/** music-application://desktop/artist?artistId=1 → yandexmusic://artist?artistId=1 */
function toClientLink(value) {
  if (typeof value !== 'string' || !INTERNAL_PREFIX.test(value)) return null;
  return value.replace(INTERNAL_PREFIX, 'yandexmusic://');
}

/** Переписывает ссылку в последнем аргументе прямо в массиве. */
function rewriteArgs(args) {
  if (!Array.isArray(args) || !args.length) return;

  const link = toClientLink(args[args.length - 1]);
  if (!link) return;

  log.info('Ярлык страницы клиента:', args[args.length - 1], '→', link);
  args[args.length - 1] = link;
}

function start() {
  // Мод подключается первой строкой клиента, так что argv ещё не прочитан.
  rewriteArgs(process.argv);

  // Обработчик клиента получает тот же массив — правим его раньше клиента.
  app.prependListener('second-instance', (_event, commandLine) => {
    rewriteArgs(commandLine);
  });

  if (!app.isDefaultProtocolClient(SCHEME)) {
    app.setAsDefaultProtocolClient(SCHEME);
    log.info(`Схема ${SCHEME}:// зарегистрирована за клиентом`);
  }
}

module.exports = { start, toClientLink };
