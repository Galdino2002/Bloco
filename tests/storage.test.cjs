'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readArrayWithBackup, writeArrayWithBackup } = require('../storage');
function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, async getItem(key) { return values.has(key) ? values.get(key) : null; }, async setItem(key, value) { values.set(key, value); }, async removeItem(key) { values.delete(key); } };
}
test('rotates the previous valid snapshot before writing', async () => {
  const storage = createStorage({ current: '[{"id":"old"}]' });
  await writeArrayWithBackup(storage, 'current', 'backup', [{ id: 'new' }]);
  assert.equal(storage.values.get('backup'), '[{"id":"old"}]');
  assert.deepEqual(JSON.parse(storage.values.get('current')), [{ id: 'new' }]);
});
test('does not replace a valid backup with a corrupt primary', async () => {
  const storage = createStorage({ current: '{broken', backup: '[{"id":"safe"}]' });
  await writeArrayWithBackup(storage, 'current', 'backup', [{ id: 'new' }]);
  assert.equal(storage.values.get('backup'), '[{"id":"safe"}]');
});
test('recovers the last valid backup when the primary is corrupt', async () => {
  const storage = createStorage({ current: '{broken', backup: '[{"id":"safe"}]' });
  const result = await readArrayWithBackup(storage, 'current', 'backup');
  assert.equal(result.recovered, true);
  assert.deepEqual(result.items, [{ id: 'safe' }]);
  assert.equal(storage.values.get('current'), storage.values.get('backup'));
});
test('recovers a backup when the primary key is missing', async () => {
  const storage = createStorage({ backup: '[{"id":"safe"}]' });
  const result = await readArrayWithBackup(storage, 'current', 'backup');
  assert.equal(result.recovered, true);
  assert.deepEqual(result.items, [{ id: 'safe' }]);
});
test('keeps the previous snapshot when the primary write fails', async () => {
  const storage = createStorage({ current: '[{"id":"old"}]' });
  const setItem = storage.setItem.bind(storage);
  storage.setItem = async (key, value) => { if (key === 'current') throw new Error('disk full'); return setItem(key, value); };
  await assert.rejects(writeArrayWithBackup(storage, 'current', 'backup', [{ id: 'new' }]), /disk full/);
  assert.equal(storage.values.get('backup'), '[{"id":"old"}]');
  assert.equal(storage.values.get('current'), '[{"id":"old"}]');
});
test('rejects non-array snapshots', async () => {
  await assert.rejects(writeArrayWithBackup(createStorage(), 'current', 'backup', {}), /lista/);
});
