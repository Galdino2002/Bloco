'use strict';

async function readArrayWithBackup(storage, key, backupKey) {
  const raw = await storage.getItem(key);
  if (raw !== null) {
    try {
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) throw new Error('O conteúdo salvo não é uma lista válida.');
      return { items, recovered: false };
    } catch (primaryError) {
      const backupRaw = await storage.getItem(backupKey);
      if (backupRaw === null) throw primaryError;
      let backup;
      try { backup = JSON.parse(backupRaw); if (!Array.isArray(backup)) throw primaryError; }
      catch { throw primaryError; }
      await storage.setItem(key, backupRaw);
      return { items: backup, recovered: true };
    }
  }
  const backupRaw = await storage.getItem(backupKey);
  if (backupRaw === null) return { items: [], recovered: false };
  try {
    const backup = JSON.parse(backupRaw);
    if (!Array.isArray(backup)) return { items: [], recovered: false };
    await storage.setItem(key, backupRaw);
    return { items: backup, recovered: true };
  } catch { return { items: [], recovered: false }; }
}

async function writeArrayWithBackup(storage, key, backupKey, items) {
  if (!Array.isArray(items)) throw new TypeError('O conteúdo a salvar precisa ser uma lista.');
  const serialized = JSON.stringify(items);
  if (typeof serialized !== 'string') throw new Error('Não foi possível serializar os dados.');
  const previous = await storage.getItem(key);
  if (previous !== null) {
    try {
      const parsed = JSON.parse(previous);
      if (Array.isArray(parsed)) await storage.setItem(backupKey, previous);
    } catch { /* preserve the last known-good backup */ }
  }
  await storage.setItem(key, serialized);
  return true;
}

module.exports = { readArrayWithBackup, writeArrayWithBackup };
