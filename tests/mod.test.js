'use strict';
// Проверки чистых кусков мода — тех, что работают без Electron и клиента.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * Достаёт одну функцию из файла мода. Модули целиком подключить нельзя:
 * они тянут за собой electron, которого в проверках нет.
 */
function extract(file, name) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `в ${file} нет функции ${name}`);

  // Конец — первая закрывающая скобка в начале строки.
  const end = code.indexOf('\n}', start);
  assert.ok(end > start, `не нашёл конец функции ${name}`);

  return code.slice(start, end + 2);
}

test('адреса из панели плеера приводятся к сайту', () => {
  const source = extract('mod/renderer/playerbar-watch.js', 'absolute');
  const absolute = new Function(`const WEB_BASE='https://music.yandex.ru';${source};return absolute`)();

  // Так ссылки записаны внутри клиента: на сайте таких страниц нет.
  assert.strictEqual(
    absolute('/album?albumId=9553251'),
    'https://music.yandex.ru/album/9553251'
  );
  assert.strictEqual(
    absolute('/album?albumId=9553251&trackId=61304852'),
    'https://music.yandex.ru/album/9553251/track/61304852'
  );
  // Именно так ссылка записана в панели плеера живого клиента.
  assert.strictEqual(
    absolute('/album/track?albumId=20395191&trackId=98300382'),
    'https://music.yandex.ru/album/20395191/track/98300382'
  );

  assert.strictEqual(absolute('/artist?artistId=1234'), 'https://music.yandex.ru/artist/1234');
  assert.strictEqual(
    absolute('/playlist?owner=yamusic&kind=42'),
    'https://music.yandex.ru/users/yamusic/playlists/42'
  );

  // Клиент живёт на своём протоколе — наружу такое отдавать нельзя.
  assert.strictEqual(
    absolute('music-application://desktop/album?albumId=9553251'),
    'https://music.yandex.ru/album/9553251'
  );

  // Обычный адрес сайта остаётся собой.
  assert.strictEqual(
    absolute('https://music.yandex.ru/album/9553251/track/61304852'),
    'https://music.yandex.ru/album/9553251/track/61304852'
  );

  assert.strictEqual(absolute(null), null);
});

test('номер альбома читается из обоих видов ссылки', () => {
  const source = extract('mod/lib/album.js', 'albumIdFrom');
  const albumIdFrom = new Function(`${source};return albumIdFrom`)();

  assert.strictEqual(albumIdFrom('/album?albumId=9553251&trackId=1'), '9553251');
  assert.strictEqual(
    albumIdFrom('https://music.yandex.ru/album/9553251/track/61304852'),
    '9553251'
  );
  assert.strictEqual(albumIdFrom('https://music.yandex.ru/artist/1234'), null);
  assert.strictEqual(albumIdFrom(null), null);
});

test('склонение в заголовках разделов настроек', () => {
  const source = extract('mod/renderer/settings-ui.js', 'countLabel');
  const countLabel = new Function(`${source};return countLabel`)();

  assert.strictEqual(countLabel(1), '1 настройка');
  assert.strictEqual(countLabel(3), '3 настройки');
  assert.strictEqual(countLabel(6), '6 настроек');
  assert.strictEqual(countLabel(11), '11 настроек');
  assert.strictEqual(countLabel(21), '21 настройка');
});

test('список изменений разбирается по версиям', () => {
  const changelog = require(path.join(ROOT, 'scripts', 'changelog.js'));
  const version = require(path.join(ROOT, 'package.json')).version;

  const items = changelog.itemsFor('1.1.4');
  assert.ok(items.length > 0, 'в журнале нет раздела 1.1.4');
  assert.ok(
    items.every((item) => !item.startsWith('-')),
    'дефис остался в тексте пункта'
  );

  assert.strictEqual(changelog.itemsFor('0.0.0-нет-такой').length, 0);

  // Выпускать версию без записи в журнале незачем: релиз выйдет пустым.
  const unreleased = changelog.notesFor('Не выпущено');
  assert.ok(
    changelog.notesFor(version) || unreleased,
    `в CHANGELOG.md нет ни раздела ${version}, ни «Не выпущено»`
  );
});

test('наружу открываются только безопасные ссылки', () => {
  const code = fs.readFileSync(path.join(ROOT, 'mod/lib/updates.js'), 'utf8');
  const line = code.match(/const allowed =[\s\S]{0,320}?;/);

  assert.ok(line, 'в моде больше нет проверки открываемых ссылок');

  const allowed = new Function('url', `${line[0]} return allowed;`);

  // Плашка для трансляции живёт на своём же компьютере по http.
  assert.ok(allowed('http://127.0.0.1:8462/'));
  assert.ok(allowed('http://localhost:8462/'));
  assert.ok(allowed('https://lvl.su/'));

  // Чужое по http не открываем, и похожий на свой адрес — тоже.
  assert.ok(!allowed('http://example.com/'));
  assert.ok(!allowed('http://127.0.0.1.evil.com/'));
  assert.ok(!allowed('file:///etc/passwd'));
  assert.ok(!allowed(null));
});

test('все настройки мода видны в окне настроек', () => {
  const defaults = fs.readFileSync(path.join(ROOT, 'mod/lib/settings.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'mod/renderer/settings-ui.js'), 'utf8');

  const block = defaults.slice(defaults.indexOf('const DEFAULTS'), defaults.indexOf('let values'));
  const keys = [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);

  // Служебные значения человеку показывать нечего: их мод хранит сам.
  const hidden = new Set([
    'miniplayerPosition',
    'miniplayerSize',
    'windowSize',
    'hintShown',
    'presetUndone',
    'discordApplicationId',
    'progress',
  ]);

  const missing = keys.filter((key) => !hidden.has(key) && !ui.includes(key));
  assert.deepStrictEqual(missing, [], `настройки есть, а переключателей нет: ${missing}`);
});
