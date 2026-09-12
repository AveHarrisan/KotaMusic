'use strict';
// Точка входа мода в главном процессе клиента.

const branding = require('./branding');
const log = require('./lib/log');

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

  // Папку кеша нужно задать до готовности приложения, поэтому первым.
  require('./lib/tweaks').start();
  require('./lib/hotkeys').start();
  require('./lib/taskbar').start();
  require('./lib/miniplayer').start();
  require('./lib/rich-presence').start();
  require('./lib/stream').start();
  require('./lib/updates').start();

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
