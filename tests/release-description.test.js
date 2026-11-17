'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CLIENT_ONLY, previousRelease, describe } = require('../scripts/release-description');

test('та же версия мода: только обновление клиента в релизе и окне обновления', () => {
  const result = describe({ clientVersion: '5.127.0', modVersion: '1.2.22' }, { modVersion: '1.2.22' });
  assert.deepEqual(result.notes, [CLIENT_ONLY]);
  assert.ok(result.body.includes(CLIENT_ONLY));
  assert.ok(!result.body.includes('Ярлыки страниц'));
});

test('новая версия мода и первая публикация сохраняют список изменений', () => {
  for (const previous of [null, { modVersion: '1.2.21' }]) {
    const result = describe({ clientVersion: '5.127.0', modVersion: '1.2.22' }, previous);
    assert.ok(result.notes.length > 0);
    assert.ok(result.body.includes('Ярлыки страниц'));
    assert.ok(!result.body.includes(CLIENT_ONLY));
  }
});

test('предыдущий клиент выбирается по версии, игнорируя текущий, будущий и черновики', () => {
  const releases = [
    { tag_name: 'mod-5.9.0' }, { tag_name: 'installer' },
    { tag_name: 'mod-5.128.0' }, { tag_name: 'mod-5.127.0' },
    { tag_name: 'mod-5.126.2', draft: true },
    { tag_name: 'mod-5.126.3', prerelease: true }, { tag_name: 'mod-5.126.1' },
  ];
  assert.equal(previousRelease(releases, '5.127.0').tag_name, 'mod-5.126.1');
  assert.equal(previousRelease(releases, '5.1.0'), undefined);
});
