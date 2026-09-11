'use strict';
// Всё, что мод показывает о себе. Держим в одном месте, чтобы не искать
// строки по коду при переименовании.

module.exports = {
  name: 'KotaMusic',
  // Проставляется сборкой: внутри asar путь наружу ведёт в файлы клиента.
  version: '0.0.0-dev',

  // Версия клиента, из которой собран этот app.asar. По ней мод понимает,
  // что клиент обновился и вышла свежая сборка.
  builtForClient: '0.0.0-dev-client',
  repositoryUrl: 'https://github.com/AveHarrisan/KotaMusic',
  supportUrl: 'https://boosty.to/aveharrisan',
  authorUrl: 'https://t.me/aveharrisan',

  // Приложение Discord, от имени которого показывается статус.
  // Создаётся на https://discord.com/developers/applications — его название
  // видно в профиле как «слушает <название>».
  discord: {
    applicationId: process.env.KOTAMUSIC_DISCORD_APP_ID || '1547602563673886760',

    // Discord разрешает не больше двух кнопок.
    showButtons: true,

    // Название трека в списке участников и кликабельные строки статуса.
    modernFields: true,

    // Как показывать время трека. Больше одного Discord не умеет:
    //   'bar'     — полоса с началом и концом, видна в карточке профиля;
    //   'counter' — счётчик «♪ 0:24», виден и в профиле, и в голосовом канале.
    progress: 'bar',
  },

  // Подписи в настройках клиента
  labels: {
    repository: 'Репозиторий модификации на GitHub',
    support: 'Поддержать разработку модификации',
  },
};
