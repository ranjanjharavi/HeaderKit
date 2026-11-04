import assert from 'node:assert/strict';
import test from 'node:test';

import { clearStatus, showStatus } from '../../../extension/shared/ui/ui.js';

test('showStatus preserves component classes while adding transient state', () => {
  const classes = new Set(['status-msg', 'workspace-status']);
  let messageSetWhileVisible = false;
  const element = {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name))
    },
    set textContent(value) {
      this.message = value;
      messageSetWhileVisible = classes.has('visible');
    },
    get textContent() {
      return this.message || '';
    }
  };
  let dismissStatus = () => {};
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.document = { getElementById: () => element };
  globalThis.setTimeout = (callback) => {
    dismissStatus = callback;
    return 1;
  };
  globalThis.clearTimeout = () => {};

  try {
    showStatus('status', 'Default is now active.', 'success');
    assert.equal(element.textContent, 'Default is now active.');
    assert.equal(messageSetWhileVisible, true);
    assert.deepEqual([...classes].sort(), ['status-msg', 'success', 'visible', 'workspace-status']);

    dismissStatus();
    assert.deepEqual([...classes].sort(), ['status-msg', 'workspace-status']);
  } finally {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

function createStatus(t) {
  const classes = new Set();
  const element = {
    textContent: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    }
  };
  const timers = new Map();
  let nextTimer = 1;
  const originals = {
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  globalThis.document = { getElementById: () => element };
  globalThis.setTimeout = (callback) => {
    timers.set(nextTimer, callback);
    return nextTimer++;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  t.after(() => Object.assign(globalThis, originals));
  return { element, timers };
}

test('an error stays until the next message replaces it, because it may need acting on', (t) => {
  const { element, timers } = createStatus(t);
  showStatus('status', 'Pause all rules, then try again.', 'error');
  assert.equal(timers.size, 0);
  assert.equal(element.classList.contains('visible'), true);

  showStatus('status', 'Rule paused.', 'success');
  assert.equal(element.textContent, 'Rule paused.');
  assert.equal(element.classList.contains('error'), false);
  assert.equal(timers.size, 1);
});

test('an error cancels the timer left by an earlier success message', (t) => {
  const { element, timers } = createStatus(t);
  showStatus('status', 'Rule paused.', 'success');
  showStatus('status', 'Could not remove that rule.', 'error');
  assert.equal(timers.size, 0);
  assert.equal(element.textContent, 'Could not remove that rule.');
});

test('clearStatus removes the message, its state and any timer', (t) => {
  const { element, timers } = createStatus(t);
  showStatus('status', 'Rule paused.', 'success');
  clearStatus('status');
  assert.equal(element.textContent, '');
  assert.equal(element.classList.contains('visible'), false);
  assert.equal(element.classList.contains('success'), false);
  assert.equal(timers.size, 0);
  assert.doesNotThrow(() => {
    document.getElementById = () => null;
    clearStatus('missing');
  });
});
