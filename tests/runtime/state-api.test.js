import assert from 'node:assert/strict';
import test from 'node:test';
import { createStateRefresh } from '../../extension/shared/runtime/state-api.js';
import { createUiHarness } from '../helpers/ui-harness.js';

test('snapshot refresh applies only the latest result when reads finish out of order', async (t) => {
  createUiHarness(t);
  const replies = [];
  chrome.runtime.sendMessage = (message, callback) => {
    assert.equal(message.type, 'headerkit:state:get');
    replies.push(callback);
  };
  chrome.permissions = { getAll: (callback) => callback({ origins: [] }) };
  const applied = [];
  const { refresh } = createStateRefresh((snapshot) => applied.push(snapshot));
  const older = refresh();
  const newer = refresh();
  replies[1]({ ok: true, rules: [{ id: 2 }], profiles: [], activation: {} });
  assert.equal(await newer, true);
  replies[0]({ ok: true, rules: [{ id: 1 }], profiles: [], activation: {} });
  assert.equal(await older, false);
  assert.deepEqual(applied.map((snapshot) => snapshot.rules), [[{ id: 2 }]]);
});

test('storage refresh scheduling coalesces a burst and invalidates an older pending read', async (t) => {
  createUiHarness(t);
  const replies = [];
  chrome.runtime.sendMessage = (_message, callback) => replies.push(callback);
  chrome.permissions = { getAll: (callback) => callback({ origins: [] }) };
  const applied = [];
  const { refresh, schedule } = createStateRefresh((snapshot) => applied.push(snapshot));
  const older = refresh();
  schedule();
  schedule();
  replies[0]({ ok: true, rules: [], profiles: [], activation: {} });
  assert.equal(await older, false);
  assert.equal(replies.length, 2);
  replies[1]({ ok: true, rules: [{ id: 2 }], profiles: [], activation: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied.length, 1);
});

test('a failed snapshot read leaves current page state intact and a later refresh can recover', async (t) => {
  createUiHarness(t);
  chrome.permissions = { getAll: (callback) => callback({ origins: [] }) };
  chrome.runtime.sendMessage = (_message, callback) => callback({ ok: false, error: 'Read failed' });
  const original = { rules: [{ id: 1 }] };
  let current = original;
  const { refresh } = createStateRefresh((snapshot) => { current = snapshot; });
  await assert.rejects(refresh(), /Read failed/);
  assert.equal(current, original);
  chrome.runtime.sendMessage = (_message, callback) => callback({ ok: true, rules: [{ id: 2 }], profiles: [], activation: {} });
  await refresh();
  assert.deepEqual(current.rules, [{ id: 2 }]);
});