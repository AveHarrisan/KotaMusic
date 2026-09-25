'use strict';
// Точка входа мода в главном процессе клиента.

const branding = require('./branding');
const log = require('./lib/log');

// ⚠️Node даёт соединению по каждому адресу всего 250 мс, а потом берёт
// следующий, и с последним сдаётся с «fetch failed». Если адресов несколько,
// а связь медленная, не успевает ни один. Так было 25.09.2026: в hosts
// у человека вписаны адреса GitHub, IPv4 с соединением за ~300 мс и
// нерабочий IPv6, и обновления мода не скачивались. Даём 3 секунды.
try {
  require('net').setDefaultAutoSelectFamilyAttemptTimeout(3000);
} catch {}

try {
  const { app } = require('electron');

  log.info(
    `${branding.name} ${branding.version} загружен; клиент ${app?.getVersion?.()}, ` +
      `electron ${process.versions.electron}`
  );

  require('./lib/settings').start();

  // Признак читает врезка в клиенте: пока он стоит, клиент сам себя
  // не обновляет — обновление клиента вместе с модом делает мод.
  globalThis.__kotamusicHoldUpdates =
    require('./lib/settings').get().holdClientUpdates !== false;

  // Папку данных клиента Electron принимает только до готовности.
  require('./lib/storage').applyPath();

  // Аппаратное ускорение выключается только до готовности приложения.
  require('./lib/window').applyHardwareAcceleration();

  // Каждую часть запускаем отдельно: одна упавшая не должна уносить с
  // собой остальные. Так однажды и вышло — ошибка в мини-плеере оставила
  // клиент без Discord, плашки и обновлений, а понять это было нельзя.
  const startPart = (name) => {
    try {
      require(`./lib/${name}`).start();
    } catch (e) {
      log.error(`Часть мода не запустилась (${name}):`, e);
    }
  };

  // Папку кеша нужно задать до готовности приложения, поэтому первым.
  for (const name of [
    'tweaks',
    'hotkeys',
    'taskbar',
    'miniplayer',
    'rich-presence',
    'stream',
    'window',
    'restart',
    'updates',
    'diagnostics',
    'downloads',
    'storage',
    'lyrics',
  ]) {
    startPart(name);
  }

  // Открыть страницу настроек сразу после запуска — удобно для снимков
  // экрана и проверок. В обычной работе переменная не задана.
  if (process.env.KOTAMUSIC_OPEN_SETTINGS) {
    const { app, BrowserWindow } = require('electron');

    app.once('ready', () => {
      setTimeout(() => {
        const [window] = BrowserWindow.getAllWindows();
        window?.webContents.send('desktop:navigation:open-deeplink', '/settings');
        log.info('Открываю настройки');
      }, 12000);
    });
  }
} catch (e) {
  log.error('Ошибка запуска мода:', e);
}
