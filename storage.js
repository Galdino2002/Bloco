'use strict';
async function readArrayWithBackup(storage, key, backupKey) {
 const raw = await storage.getItem(key);
 if (raw !== null) {
  try { const items = JSON.parse(raw); if (!Array.isArray(items)) throw new Error('Invalid saved list'); return { items, recovered: false }; }
  catch (error) { const backupRaw = await storage.getItem(backupKey); if (backupRaw === null) throw error; const backup = JSON.parse(backupRaw); if (!Array.isArray(backup)) throw error; await storage.setItem(key, backupRaw); return { items: backup, recovered: true }; }
 }
 const backupRaw = await storage.getItem(backupKey);
 if (backupRaw === null) return { items: [], recovered: false };
 try { const backup = JSON.parse(backupRaw); if (!Array.isArray(backup)) return { items: [], recovered: false }; await storage.setItem(key, backupRaw); return { items: backup, recovered: true }; }
 catch { return { items: [], recovered: false }; }
}
async function writeArrayWithBackup(storage, key, backupKey, items) {
 if (!Array.isArray(items)) throw new TypeError('O conteúdo a salvar precisa ser uma lista');
 const serialized = JSON.stringify(items);
 const previous = await storage.getItem(key);
 if (previous !== null) { try { if (Array.isArray(JSON.parse(previous))) await storage.setItem(backupKey, previous); } catch { /* keep last known good backup */ } }
 await storage.setItem(key, serialized);
 return true;
}
module.exports = { readArrayWithBackup, writeArrayWithBackup };
