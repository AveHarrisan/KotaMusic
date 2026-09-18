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

test('значок загрузок считает только то, что качают люди', () => {
  const code = fs.readFileSync(path.join(ROOT, 'scripts/badges.js'), 'utf8');
  const list = code.match(/const COUNTED = new Set\(\[[\s\S]*?\]\);/);

  assert.ok(list, 'в значках больше нет списка учитываемых файлов');

  const counted = new Set([...list[0].matchAll(/'([^']+)'/g)].map((m) => m[1]));

  // Считаем сам мод: установщик скачивают один раз, дальше мод обновляет
  // себя сам, и именно архив показывает, сколько людей им пользуются.
  assert.ok(counted.has('app.asar'), 'app.asar перестал считаться');

  // А эти качают сами мод и установщик при проверке обновлений — из-за
  // них число загрузок росло само по себе.
  for (const name of ['build-info.json', 'installer-info.json']) {
    assert.ok(!counted.has(name), `${name} снова попал в счёт`);
  }
});

test('загрузки не обнуляются при выпуске новой версии мода', () => {
  const { combine } = require(path.join(ROOT, 'scripts', 'badges.js'));

  const release = (count) => [
    { tag_name: 'mod-5.119.0', assets: [{ name: 'app.asar', download_count: count }] },
  ];

  // Люди скачали мод пять раз.
  let { state, downloads } = combine({ carried: 0, assets: {} }, release(5));
  assert.strictEqual(downloads, 5);

  // Вышла новая версия: файл в релизе заменён, счётчик у него с нуля.
  ({ state, downloads } = combine(state, release(0)));
  assert.strictEqual(downloads, 5, 'прошлые загрузки потерялись');

  // Скачали ещё дважды — счёт продолжается, а не начинается заново.
  ({ state, downloads } = combine(state, release(2)));
  assert.strictEqual(downloads, 7);

  // Клиент обновился, появился новый релиз — считаем оба.
  ({ downloads } = combine(state, [
    ...release(2),
    { tag_name: 'mod-5.120.0', assets: [{ name: 'app.asar', download_count: 3 }] },
  ]));
  assert.strictEqual(downloads, 10);
});

test('удалённый релиз не уносит загрузки с собой', () => {
  const { combine } = require(path.join(ROOT, 'scripts', 'badges.js'));

  const first = combine({ carried: 0, assets: {} }, [
    { tag_name: 'mod-5.119.0', assets: [{ name: 'app.asar', download_count: 4 }] },
  ]);

  const second = combine(first.state, []);
  assert.strictEqual(second.downloads, 4);
});

test('значки в описании берутся из наших же чисел', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.ok(
    !/img\.shields\.io\/github\/downloads/.test(readme),
    'вернулся готовый значок shields, считающий служебные файлы'
  );
  assert.match(readme, /img\.shields\.io\/endpoint\?url=[^)]*badges\/downloads\.json/);
});

test('все настройки мода видны в окне настроек', () => {
  const defaults = fs.readFileSync(path.join(ROOT, 'mod/lib/settings.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'mod/renderer/settings-ui.js'), 'utf8');

  const block = defaults.slice(defaults.indexOf('const DEFAULTS'), defaults.indexOf('let values'));
  const keys = [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);

  // Служебные значения человеку показывать нечего: их мод хранит сам.
  const hidden = new Set([
    'miniplayerPosition',
    'lyricsPanelBox',
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

test('скорость скачивания пишется привычными единицами', () => {
  // Берём обе функции разом: счётчик и подпись работают в паре.
  const source = extract('mod/lib/downloads.js', 'addBytes') + extract('mod/lib/downloads.js', 'speedText');
  const made = new Function(
    `const speed = { bytes: 0, since: Date.now() - 1000, value: 0 };${source};return { addBytes, speedText }`
  )();

  // Пока ничего не качали, писать нечего.
  assert.strictEqual(made.speedText(), '');

  made.addBytes(5 * 1024 * 1024);
  assert.match(made.speedText(), /^\d+([.,]\d)? (Б|КБ|МБ)\/с$/);
});

test('остановка гасит только своё задание, новая просьба её не снимает', () => {
  // Собираем ту же связку, что живёт в mod/lib/downloads.js: задание
  // создаётся, когда до него дошла очередь, и останавливается лично.
  const source = [
    extract('mod/lib/downloads.js', 'beginJob'),
    extract('mod/lib/downloads.js', 'stopAll'),
    extract('mod/lib/downloads.js', 'isStop'),
  ].join('\n');

  const make = new Function(
    `let job = null; const log = { info() {} };
     ${source};
     return { beginJob, stopAll, isStop, peek: () => job };`
  );

  const { beginJob, stopAll, isStop, peek } = make();

  const first = beginJob();
  assert.strictEqual(first.stopped, false);

  // Человек нажал «Остановить», пока задание идёт.
  assert.strictEqual(stopAll(), true);
  assert.strictEqual(first.stopped, true);
  assert.strictEqual(isStop(null, first), true);

  // Повторное нажатие ничего не ломает и не врёт про успех.
  assert.strictEqual(stopAll(), false);

  // ⚠️Главное: следующая просьба скачать начинает своё задание, но
  // остановленное остаётся остановленным — раньше общий признак
  // снимался, и прерванная очередь продолжала качать.
  const second = beginJob();
  assert.strictEqual(second.stopped, false);
  assert.strictEqual(first.stopped, true);
  assert.strictEqual(isStop(null, first), true);
  assert.strictEqual(peek(), second);
});

test('обрыв загрузки считается остановкой, а не ошибкой', () => {
  const source = extract('mod/lib/downloads.js', 'isStop');
  const isStop = new Function(`let job = null;${source};return isStop`)();

  assert.strictEqual(isStop({ name: 'AbortError' }), true);
  assert.strictEqual(isStop(new Error('сеть отвалилась')), false);
  assert.strictEqual(isStop(new Error('сеть отвалилась'), { stopped: true }), true);
});
