'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistory, commitHistory, undoHistory, redoHistory } = require('../drawingHistory');

test('creates an isolated initial snapshot', () => {
  const initial = [{ id: 'stroke-1', points: [{ x: 1, y: 2 }] }];
  const history = createHistory(initial);
  initial[0].points[0].x = 99;
  assert.equal(history.present[0].points[0].x, 1);
  assert.equal(history.past.length, 0);
});

test('undoes and redoes complete drawing snapshots', () => {
  const first = [{ id: 'a' }];
  const second = [{ id: 'a' }, { id: 'b' }];
  const history = commitHistory(createHistory(first), second);
  const undone = undoHistory(history);
  assert.deepEqual(undone.present, first);
  assert.deepEqual(undone.future, [second]);
  const redone = redoHistory(undone);
  assert.deepEqual(redone.present, second);
  assert.equal(redone.future.length, 0);
});

test('a new edit after undo clears the redo branch', () => {
  const first = [{ id: 'a' }];
  const second = [{ id: 'a' }, { id: 'b' }];
  const third = [{ id: 'c' }];
  const undone = undoHistory(commitHistory(createHistory(first), second));
  const edited = commitHistory(undone, third);
  assert.deepEqual(edited.present, third);
  assert.equal(edited.future.length, 0);
});

test('keeps the configured history limit', () => {
  let history = createHistory([], 3);
  history = commitHistory(history, [1]);
  history = commitHistory(history, [1, 2]);
  history = commitHistory(history, [1, 2, 3]);
  history = commitHistory(history, [1, 2, 3, 4]);
  assert.equal(history.past.length, 3);
  assert.deepEqual(undoHistory(history).present, [1, 2, 3]);
});

test('does not retain references to committed mutable input', () => {
  const history = createHistory([]);
  const next = [{ id: 'a', points: [{ x: 5, y: 6 }] }];
  const committed = commitHistory(history, next);
  next[0].points[0].x = 500;
  assert.equal(committed.present[0].points[0].x, 5);
});

test('returns the same history when undo or redo is unavailable', () => {
  const history = createHistory([]);
  assert.equal(undoHistory(history), history);
  assert.equal(redoHistory(history), history);
});
