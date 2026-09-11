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

  // Папку кеша нужно задать до готовности приложения, поэтому первым.
  require('./lib/tweaks').start();
  require('./lib/hotkeys').start();
  require('./lib/rich-presence').start();
} catch (e) {
  log.error('Ошибка запуска мода:', e);
}
