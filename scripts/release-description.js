'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const changelog = require('./changelog');

const CLIENT_ONLY = 'Обновилась версия Ямузыка, все остальное без изменения';
const ROOT = path.join(__dirname, '..');

function previousRelease(releases, clientVersion) {
  return releases
    .filter((r) => !r.draft && !r.prerelease && /^mod-\d+\.\d+\.\d+$/.test(r.tag_name))
    .filter((r) => compare(r.tag_name.slice(4), clientVersion) < 0)
    .sort((a, b) => compare(b.tag_name.slice(4), a.tag_name.slice(4)))[0];
}

function compare(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function describe(info, previous) {
  const clientOnly = previous?.modVersion === info.modVersion;
  const notes = clientOnly ? [CLIENT_ONLY] : changelog.itemsFor(info.modVersion);
  const changes = clientOnly ? CLIENT_ONLY : changelog.notesFor(info.modVersion);
  const body = [
    `Собрано автоматически для клиента **${info.clientVersion}**, версия мода **${info.modVersion}**.`,
    '',
    ...(changes ? ['### Что изменилось', '', changes, ''] : []),
    'Первая установка — через установщик KotaMusic: одной подмены файла',
    'мало, Windows и macOS проверяют целостность `app.asar`. Дальше мод',
    'обновляет себя сам.',
    '',
  ].join('\n');
  return { body, notes };
}

function main() {
  const infoPath = path.join(ROOT, 'dist/build-info.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY || 'AveHarrisan/KotaMusic';
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat();
  const previous = previousRelease(releases, info.clientVersion);
  // Ошибка чтения предыдущей сборки останавливает шаг: нельзя выдавать
  // повтор старого списка правок за изменения новой версии.
  const previousInfo = previous
    ? JSON.parse(gh('release', 'download', previous.tag_name, '--repo', repo,
      '--pattern', 'build-info.json', '--output', '-'))
    : null;
  const result = describe(info, previousInfo);
  fs.writeFileSync(path.join(ROOT, 'release-body.md'), result.body);
  fs.writeFileSync(infoPath, JSON.stringify({ ...info, notes: result.notes }, null, 2));
  console.log(result.body);
}

module.exports = { CLIENT_ONLY, previousRelease, describe };
if (require.main === module) main();
