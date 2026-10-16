import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../helpers/source.js';
import { installBackgroundHarness } from '../helpers/background-harness.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';

const backgroundSource = readSource('extension/background.js');

test('site permission changes immediately rebuild the applied rule set', () => {
  assert.match(backgroundSource, /chrome\.permissions\.onAdded\.addListener/);
  assert.match(backgroundSource, /chrome\.permissions\.onRemoved\.addListener/);
  assert.match(backgroundSource, /refreshAfterPermissionChange/);
});

test('background state changes and reads share a serial queue', () => {
  assert.match(backgroundSource, /const enqueueBackgroundTask = createSerialQueue\(\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => handleRuleMessage\(message\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => handleActivationMessage\(message\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => initialize\(\{ newBrowserSession: true \}\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => applyExpiry\(\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => toggleMasterSwitch\(\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => refreshAfterPermissionChange\(\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => refreshTabBadge\(tabId/);
});

async function worker(t, stored = {}) {
  const originalChrome = globalThis.chrome;
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { globalThis.chrome = originalChrome; console.error = originalError; });
  const storage = {
    profiles: [{ id: 'default', name: 'Default' }, { id: 'staging', name: 'Staging' }],
    headerRules: [],
    activation: createDefaultActivation(),
    ...stored
  };
  const origins = ['https://example.com/*', 'https://staging.example.com/*'];
  const removed = [];
  let failWrite = false;
  const chromeApi = {
    runtime: { lastError: null },
    storage: { local: {
      get: (keys, callback) => callback(structuredClone(Object.fromEntries(keys.map((key) => [key, storage[key]])))),
      set: (value, callback) => {
        if (failWrite) {
          failWrite = false;
          chromeApi.runtime.lastError = { message: 'Storage failed' };
          callback();
          chromeApi.runtime.lastError = null;
          return;
        }
        Object.assign(storage, structuredClone(value));
        callback();
      }
    } },
    permissions: {
      getAll: (callback) => callback({ origins }),
      remove: ({ origins: released }, callback) => {
        removed.push(...released);
        callback(true);
      }
    }
  };
  const harness = await installBackgroundHarness(chromeApi);
  return {
    ...harness,
    storage,
    removed,
    failNextWrite: () => { failWrite = true; },
    send: (message) => new Promise((resolve) => chromeApi.runtime.sendMessage(message, resolve))
  };
}

test('actual worker merges concurrent rule intents and rejects conflicts and stale references', async (t) => {
  const harness = await worker(t);
  const draft = { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' };
  const results = await Promise.all([
    harness.send({ type: 'reqkit:rules:add', id: 42, draft, profileId: 'default' }),
    harness.send({ type: 'reqkit:rules:add', draft: { ...draft, headerName: 'X-Other' }, profileId: 'default' })
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.deepEqual(results.map((result) => result.rule.id), [1, 2]);
  const conflict = await harness.send({ type: 'reqkit:rules:add', draft: { ...draft, pathPrefix: '/api', headerValue: 'different' }, profileId: 'default' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.field, 'headerValue');
  assert.equal(conflict.conflictId, 1);
  const duplicate = await harness.send({ type: 'reqkit:rules:add', draft, profileId: 'default' });
  assert.equal(duplicate.field, 'headerName');
  await Promise.all([
    harness.send({ type: 'reqkit:rules:set-enabled', id: 1, enabled: false }),
    harness.send({ type: 'reqkit:rules:update', id: 2, draft: { ...draft, headerName: 'X-Other', headerValue: 'updated' }, profileId: 'default' }),
    harness.send({ type: 'reqkit:rules:delete', id: 1 })
  ]);
  assert.equal(harness.storage.headerRules.length, 1);
  assert.equal(harness.storage.headerRules[0].headerValue, 'updated');
  const stale = await harness.send({ type: 'reqkit:rules:update', id: 1, draft, profileId: 'default' });
  assert.equal(stale.ok, false);
  const missingProfile = await harness.send({ type: 'reqkit:rules:add', draft, profileId: 'deleted' });
  assert.match(missingProfile.error, /profile no longer exists/);
  const before = structuredClone(harness.storage);
  assert.equal(await harness.send({ type: 'reqkit:rules:commit', rules: [] }), undefined);
  assert.equal(await harness.send({ type: 'reqkit:activation:set', activation: {} }), undefined);
  assert.deepEqual(harness.storage, before);
});

test('actual worker profile transactions roll back storage failures and clean up final-host grants', async (t) => {
  const harness = await worker(t, {
    headerRules: [{ id: 1, domain: 'staging.example.com', headerName: 'X-Test', headerValue: 'one', enabled: true, profileId: 'staging' }],
    activation: { ...createDefaultActivation(), profileId: 'staging', lastProfileId: 'staging' }
  });
  await harness.send({ type: 'reqkit:activation:set-master', enabled: true });
  const before = structuredClone(harness.storage);
  const dynamicBefore = harness.getDynamicRules();
  for (const type of ['reqkit:profiles:duplicate', 'reqkit:profiles:delete']) {
    harness.failNextWrite();
    const result = await harness.send({ type, id: 'staging', name: 'Copy' });
    assert.equal(result.ok, false);
    assert.deepEqual(harness.storage, before);
    assert.deepEqual(harness.getDynamicRules(), dynamicBefore);
    assert.deepEqual(harness.removed, []);
  }
  const copied = await harness.send({ type: 'reqkit:profiles:duplicate', id: 'staging', name: 'Copy' });
  assert.equal(copied.ok, true);
  assert.equal(copied.rules[1].enabled, false);
  assert.deepEqual(Object.keys(harness.writes.at(-1)).sort(), ['activation', 'headerRules', 'profiles']);
  await harness.send({ type: 'reqkit:profiles:delete', id: copied.profile.id });
  assert.deepEqual(harness.removed, []);
  const [deleted, stale] = await Promise.all([
    harness.send({ type: 'reqkit:profiles:delete', id: 'staging' }),
    harness.send({ type: 'reqkit:rules:add', draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'old' }, profileId: 'staging' })
  ]);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.activation.profileId, 'default');
  assert.equal(deleted.rules.length, 0);
  assert.deepEqual(harness.removed, ['https://staging.example.com/*']);
  assert.equal(stale.ok, false);
  assert.equal(harness.storage.headerRules.length, 0);
});

test('actual worker resolves expired snapshots and applies activation intents to current master state', async (t) => {
  const harness = await worker(t, { activation: { ...createDefaultActivation(), expiresAt: 1, durationMs: 60_000 } });
  const snapshot = await harness.send({ type: 'reqkit:state:get' });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.activation.profileId, null);
  assert.equal(snapshot.activation.expiresAt, null);
  await harness.send({ type: 'reqkit:activation:set-master', enabled: false });
  const selected = await harness.send({ type: 'reqkit:activation:set-profile', profileId: 'staging' });
  assert.equal(selected.activation.masterEnabled, false);
  assert.equal(selected.activation.profileId, 'staging');
  const before = structuredClone(harness.storage);
  harness.failNextWrite();
  const failed = await harness.send({ type: 'reqkit:activation:set-master', enabled: true });
  assert.equal(failed.ok, false);
  assert.deepEqual(harness.storage, before);
});
