import assert from 'node:assert/strict';
import test from 'node:test';

import { showStatus } from '../extension/shared/ui/ui.js';

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
