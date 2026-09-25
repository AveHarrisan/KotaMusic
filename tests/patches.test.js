'use strict';
// Проверки врезок на настоящем коде клиента.
//
// Сборка и так падает, когда врезка не нашла своё место. Но бывает хуже:
// точка нашлась, а смысл поменялся — тогда мод выходит молча ничего не
// умеющим. Поэтому проверяем не «применилось», а что именно получилось.
//
// Клиент берём из рабочей папки сборки: он там остаётся после первой же
// сборки. Нет его — проверки пропускаются, а не падают: на чистой машине
// качать полтораста мегабайт ради тестов незачем.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(ROOT, '.work');

/** Распакованный клиент последней сборки, если он есть. */
function clientRoot() {
  if (!fs.existsSync(WORK)) return null;

  // В рабочей папке лежат распаковки разных версий и черновые копии.
  // Годится только полная: с кодом главного процесса и с чанками.
  const full = fs
    .readdirSync(WORK)
    .map((entry) => path.join(WORK, entry, 'extracted'))
    .filter(
      (dir) =>
        fs.existsSync(path.join(dir, 'index.js')) &&
        fs.existsSync(path.join(dir, 'app', '_next', 'static', 'chunks'))
    )
    // По номерам, а не строкой: иначе 5.85 «новее» 5.121.
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  return full.length ? full[full.length - 1] : null;
}

const CLIENT = clientRoot();
const skip = CLIENT ? false : 'нет распакованного клиента в .work — сначала соберите мод';

/** Файлы, к которым врезка подобрала себя сама. */
async function targets(patch) {
  if (patch.file) return [path.join(CLIENT, patch.file)];
  return patch.findFiles(CLIENT);
}

const ctx = () => ({ branding: require(path.join(ROOT, 'mod', 'branding.js')) });

/** Весь код страницы клиента одной строкой — уже со врезками мода. */
let corpusCache = null;

function corpus() {
  if (corpusCache) return corpusCache;

  const dir = path.join(CLIENT, 'app', '_next', 'static', 'chunks');
  let code = '';

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) code += fs.readFileSync(full, 'utf8');
    }
  };

  walk(dir);
  corpusCache = code;
  return code;
}

/**
 * Код после врезки. В рабочей папке клиент может лежать уже собранным —
 * тогда врезка вернёт null, и проверять надо то, что уже лежит на диске.
 */
async function patched(patch) {
  const files = [];

  for (const file of await targets(patch)) {
    const before = fs.readFileSync(file, 'utf8');
    files.push({ file, code: patch.apply(before, ctx()) || before });
  }

  return files;
}

const byId = (id) => require(path.join(ROOT, 'patches', 'index.js')).patches.find((p) => p.id === id);

test('управление другими устройствами разрешено', { skip }, () => {
  const code = corpus();

  assert.ok(!code.includes('can_be_remote_controller:!1'), 'запрет остался — врезка вхолостую');
  assert.ok(code.includes('can_be_remote_controller:!0'), 'разрешения нет вовсе');
});

test('анимация Волны слушает признак страницы', { skip }, () => {
  const code = corpus();

  assert.match(code, /dataset\.kmLiteVibe==="1"\|\|/);

  // Родные условия должны остаться: клиент и сам переключается на
  // заглушку, когда проседают кадры.
  assert.ok(code.includes('"undefined"==typeof Worker'));
});

test('управление с телефона включается только своим опытом', { skip }, () => {
  const code = corpus();

  // Клиент спрашивает опыты двумя способами, и оба должны быть накрыты:
  // Ynison ходит через checkExperiment, а не через getExperiment.
  assert.match(code, /getExperiment\(\w+\)\{if\(\w+==="WebNextYnisonActivityInterception"/);
  assert.match(code, /checkExperiment\(\w+,\w+\)\{if\(\w+==="WebNextYnisonActivityInterception"/);
  assert.match(code, /return\{group:"on",value:\{enabled:!0\}\}/);

  // Чужие опыты Яндекса не трогаем.
  const forced = code.match(/if\(\w+==="WebNext/g) || [];
  assert.strictEqual(forced.length, 2, 'врезка вмешалась не в один эксперимент');
});

test('раздел мода встроен в настройки клиента', { skip }, () => {
  const code = corpus();
  const branding = require(path.join(ROOT, 'mod', 'branding.js'));

  // Пункты мода в списке настроек клиента и строка с его версией.
  assert.ok(code.includes(branding.repositoryUrl), 'нет пункта со ссылкой на репозиторий');
  assert.ok(code.includes(branding.supportUrl), 'нет пункта с поддержкой');
  assert.ok(code.includes(branding.name), 'нет названия мода в настройках клиента');
});

test('сценарии мода вшиты в preload клиента', { skip }, () => {
  const code = fs.readFileSync(path.join(CLIENT, 'preload.js'), 'utf8');

  assert.ok(code.includes('/* KotaMusic:renderer */'), 'сценарии мода не попали в preload');

  for (const marker of ['kotamusic:player:track', 'kmLiteVibe', 'kotamusic-player-bar']) {
    assert.ok(code.includes(marker), `в preload нет части мода: ${marker}`);
  }
});

test('точка входа мода подключается первой строкой', { skip }, async () => {
  const [main] = await patched(byId('bootstrap'));

  assert.ok(main, 'врезка не нашла главный файл клиента');
  assert.ok(main.code.startsWith("'use strict';require('./kotamusic/bootstrap.js');"));
});

test('повторное наложение ничего не ломает', { skip }, async () => {
  for (const id of ['bootstrap', 'preload']) {
    const patch = byId(id);
    if (patch.prepare) await patch.prepare();

    const [first] = await patched(patch);
    assert.ok(first, `врезка ${id} не нашла места`);

    // Второй проход обязан вернуть тот же код: иначе мод при повторной
    // сборке подключался бы дважды.
    const second = patch.apply(first.code, ctx());
    assert.strictEqual(second, first.code, `врезка ${id} накладывается дважды`);
  }
});

test('стили панели плеера цепляются за имена классов клиента', { skip }, async () => {
  const dir = path.join(CLIENT, 'app', '_next', 'static', 'css');
  const css = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('');

  // Имена в стилях мода — начала классов клиента; хвост с хешем меняется
  // от сборки к сборке, поэтому сверяем именно начала.
  for (const prefix of [
    'ChangeTimecode_timecode__',
    'ChangeTimecodeBackground_progressbar__',
  ]) {
    assert.ok(css.includes(prefix), `в клиенте больше нет класса ${prefix}`);
  }

  assert.ok(css.includes('--player-average-color-background'), 'клиент больше не красит панель под обложку');
});

test('кнопки, которые нажимает мод, в клиенте на месте', { skip }, async () => {
  const dir = path.join(CLIENT, 'app', '_next', 'static', 'chunks');

  let code = '';
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) code += fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);

  for (const id of [
    'PLAY_BUTTON',
    'PAUSE_BUTTON',
    'NEXT_TRACK_BUTTON',
    'PREVIOUS_TRACK_BUTTON',
    'LIKE_BUTTON',
    'SHUFFLE_BUTTON',
    'REPEAT_BUTTON_NO_REPEAT',
    'CHANGE_VOLUME_SLIDER',
    'TIMECODE_SLIDER',
    'PLAYERBAR_DESKTOP',
    'VIBE_PLAYERBAR',
  ]) {
    assert.ok(code.includes(`"${id}"`), `в клиенте больше нет кнопки ${id}`);
  }
});
