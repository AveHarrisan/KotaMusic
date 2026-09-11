'use strict';
// Сборка мода: качаем официальный клиент, распаковываем, накладываем
// патчи, кладём свои файлы, пакуем обратно.
//
//   node scripts/build.js --platform=linux|win32|darwin [--keep]

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const asar = require('@electron/asar');

const upstream = require('./lib/upstream');
const { patches } = require('../patches');
const branding = require('../mod/branding');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(ROOT, '.work');
const OUT = path.join(ROOT, 'dist');

const INSTALLER_KEY = { linux: 'linux', win32: 'windows', darwin: 'macos' };

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => a.replace(/^--/, '').split('='))
  );
  const platform = args.platform || process.platform;
  const key = INSTALLER_KEY[platform];
  if (!key) throw new Error(`Неизвестная платформа: ${platform}`);

  const { version, downloads } = await upstream.getLatest();
  console.log(`Клиент Яндекс Музыки: ${version} (${platform})`);

  const stage = path.join(WORK, `${version}-${platform}`);
  const installer = path.join(stage, path.basename(new URL(downloads[key]).pathname));

  if (!fs.existsSync(installer)) {
    console.log('Скачиваю установщик…');
    await upstream.download(downloads[key], installer);
  } else {
    console.log('Установщик уже скачан, использую его');
  }

  const asarPath = path.join(stage, 'app.asar');
  if (!fs.existsSync(asarPath)) {
    console.log('Достаю app.asar…');
    await upstream.extractAsar(installer, platform, stage);
  }

  const extracted = path.join(stage, 'extracted');
  await fsp.rm(extracted, { recursive: true, force: true });
  asar.extractAll(asarPath, extracted);
  console.log('Распаковано в', path.relative(ROOT, extracted));

  // Наши файлы кладём в отдельную папку — чужой код не трогаем.
  await fsp.cp(path.join(ROOT, 'mod'), path.join(extracted, 'kotamusic'), {
    recursive: true,
  });

  // Версия мода известна только сборке — проставляем её и в брендинг
  // внутри архива, и в объект, с которым работают патчи.
  const brandingPath = path.join(extracted, 'kotamusic', 'branding.js');
  const modVersion = require(path.join(ROOT, 'package.json')).version;
  branding.version = modVersion;
  await fsp.writeFile(
    brandingPath,
    (await fsp.readFile(brandingPath, 'utf8')).replace("'0.0.0-dev'", `'${modVersion}'`),
    'utf8'
  );

  const report = [];
  for (const patch of patches) {
    // Патч либо знает свой файл, либо ищет его сам: имена чанков
    // интерфейса содержат хеш и меняются с каждой версией клиента.
    let targets;
    try {
      targets = patch.file
        ? [path.join(extracted, patch.file)]
        : await patch.findFiles(extracted);
    } catch (e) {
      targets = [];
    }

    if (!targets.length) {
      report.push({ id: patch.id, ok: false, reason: 'файл не найден' });
      console.error(`  ✗ ${patch.id}: не найден файл для врезки`);
      continue;
    }

    if (typeof patch.prepare === 'function') await patch.prepare();

    let applied = 0;
    for (const target of targets) {
      const code = await fsp.readFile(target, 'utf8');
      const patched = patch.apply(code, { version, platform, branding });
      if (patched === null) continue;
      await fsp.writeFile(target, patched, 'utf8');
      applied++;
    }

    if (!applied) {
      report.push({ id: patch.id, ok: false, reason: 'точка врезки не найдена' });
      console.error(`  ✗ ${patch.id}: точка врезки не найдена`);
      continue;
    }

    report.push({ id: patch.id, ok: true });
    console.log(`  ✓ ${patch.id}`);
  }

  const failed = report.filter((r) => !r.ok);
  if (failed.length) {
    throw new Error(
      `Не применились патчи: ${failed.map((r) => r.id).join(', ')}. ` +
        `Клиент ${version} изменил код — нужна правка врезок.`
    );
  }

  await fsp.mkdir(OUT, { recursive: true });
  const outAsar = path.join(OUT, `app.asar`);
  await asar.createPackageWithOptions(extracted, outAsar, {
    // Иконки для панели задач Windows нужны настоящими файлами на диске:
    // из архива системные вызовы их не читают.
    unpackDir: '{**/node_modules/{sharp,@img}/**/*,kotamusic/assets}',
  });

  const size = (await fsp.stat(outAsar)).size;
  console.log(`\nГотово: ${path.relative(ROOT, outAsar)} (${(size / 1048576).toFixed(1)} МБ)`);

  await fsp.writeFile(
    path.join(OUT, 'build-info.json'),
    JSON.stringify({ clientVersion: version, platform, patches: report }, null, 2)
  );

  if (!('keep' in args)) await fsp.rm(extracted, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('\nСборка не удалась:', e.message);
  process.exit(1);
});
