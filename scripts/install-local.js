'use strict';
// Ручная установка мода в папку клиента — для проверки до появления GUI.
//
//   node scripts/install-local.js --client="/mnt/c/.../YandexMusic"
//   node scripts/install-local.js --client="..." --restore

const fs = require('fs');
const path = require('path');
const { patchExecutable, headerHash } = require('./lib/integrity');

const ROOT = path.join(__dirname, '..');

function findExe(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => a.replace(/^--/, '').split('='))
  );
  const client = args.client;
  if (!client) throw new Error('Укажите папку клиента: --client="/mnt/c/..."');
  if (!fs.existsSync(client)) throw new Error(`Папка не найдена: ${client}`);

  const asarPath = path.join(client, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) throw new Error(`Не найден ${asarPath}`);

  const backupAsar = asarPath + '.original';
  const exePath = findExe(client);
  const backupExe = exePath ? exePath + '.original' : null;

  if ('restore' in args) {
    if (!fs.existsSync(backupAsar)) throw new Error('Резервной копии нет, откатывать нечего');
    fs.copyFileSync(backupAsar, asarPath);
    if (backupExe && fs.existsSync(backupExe)) fs.copyFileSync(backupExe, exePath);
    console.log('Оригинальный клиент восстановлен');
    return;
  }

  // Резервные копии делаем один раз — с нетронутого клиента.
  if (!fs.existsSync(backupAsar)) {
    fs.copyFileSync(asarPath, backupAsar);
    console.log('Сохранён оригинал:', path.basename(backupAsar));
  }
  if (exePath && !fs.existsSync(backupExe)) {
    fs.copyFileSync(exePath, backupExe);
    console.log('Сохранён оригинал:', path.basename(backupExe));
  }

  const built = path.join(ROOT, 'dist', 'app.asar');
  if (!fs.existsSync(built)) throw new Error('Сначала соберите мод: node scripts/build.js');

  // Пока клиент запущен, exe занят. Если подменить asar и не суметь
  // обновить в exe хеш, клиент перестанет запускаться — поэтому
  // проверяем доступ к обоим файлам ДО первой записи.
  for (const file of [asarPath, exePath].filter(Boolean)) {
    try {
      fs.closeSync(fs.openSync(file, 'r+'));
    } catch (e) {
      throw new Error(
        `Файл занят: ${path.basename(file)}. Закройте Яндекс Музыку полностью ` +
          `(в том числе из области уведомлений) и повторите.`
      );
    }
  }

  fs.copyFileSync(built, asarPath);

  // Рядом с архивом лежат файлы, которые системе нужны настоящими:
  // иконки кнопок панели задач читаются только с диска.
  const unpacked = built + '.unpacked';
  if (fs.existsSync(unpacked)) {
    fs.cpSync(unpacked, asarPath + '.unpacked', { recursive: true, force: true });
  }

  console.log('Мод установлен, хеш заголовка:', headerHash(asarPath));

  if (exePath) {
    const res = patchExecutable(exePath, asarPath);
    console.log(
      res.patched
        ? `Проверка целостности обновлена в ${path.basename(exePath)}`
        : 'Проверка целостности уже соответствует'
    );
  } else {
    console.log('Исполняемый файл не найден — правка целостности пропущена');
  }

  console.log('\nГотово. Запускайте клиент; в логах должна быть строка [KotaMusic].');
}

try {
  main();
} catch (e) {
  console.error('Ошибка:', e.message);
  process.exit(1);
}
