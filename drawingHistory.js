'use strict';

const DEFAULT_LIMIT = 80;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHistory(initialValue = [], limit = DEFAULT_LIMIT) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  return {
    past: [clone(initialValue)],
    present: clone(initialValue),
    future: [],
    limit: safeLimit,
  };
}

function commitHistory(history, value) {
  const next = clone(value);
  const past = [...history.past, clone(history.present)];
  return {
    past: past.slice(-history.limit),
    present: next,
    future: [],
    limit: history.limit,
  };
}

function undoHistory(history) {
  if (history.past.length <= 1) return history;
  const past = history.past.slice(0, -1);
  const present = past[past.length - 1];
  return {
    past,
    present: clone(present),
    future: [clone(history.present), ...history.future].slice(0, history.limit),
    limit: history.limit,
  };
}

function redoHistory(history) {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return {
    past: [...history.past, clone(present)].slice(-history.limit),
    present: clone(present),
    future,
    limit: history.limit,
  };
}

module.exports = { createHistory, commitHistory, undoHistory, redoHistory };
