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
  t.after(async () => {
    await new Promise((resolve) => chromeApi.runtime.sendMessage({ type: 'reqkit:state:get' }, resolve));
    globalThis.chrome = originalChrome;
    console.error = originalError;
  });
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

test('until-browser-close activation uses only session rules and Chrome clears them before startup', async (t) => {
  const harness = await worker(t);
  await harness.send({ type: 'reqkit:rules:add', draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' }, profileId: 'default' });
  assert.equal(harness.getDynamicRules().length, 1);
  await harness.send({ type: 'reqkit:activation:set-duration', untilBrowserClose: true });
  assert.equal(harness.getDynamicRules().length, 0);
  assert.equal(harness.getSessionRules().length, 1);
  harness.clearSessionRules();
  assert.equal(harness.getDynamicRules().length + harness.getSessionRules().length, 0);
  chrome.runtime.onStartup.emit();
  const snapshot = await harness.send({ type: 'reqkit:state:get' });
  assert.equal(snapshot.activation.profileId, null);
  assert.equal(snapshot.rules.length, 1);
  assert.equal(harness.getSessionRules().length, 0);
});

test('switching between session and dynamic rules restores the prior set on API or storage failure', async (t) => {
  const harness = await worker(t);
  await harness.send({ type: 'reqkit:rules:add', draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' }, profileId: 'default' });
  const dynamicBefore = harness.getDynamicRules();
  for (const failure of ['api', 'storage']) {
    if (failure === 'api') {
      harness.failNextRuleUpdate('session');
    } else {
      harness.failNextWrite();
    }
    const result = await harness.send({ type: 'reqkit:activation:set-duration', untilBrowserClose: true });
    assert.equal(result.ok, false);
    assert.equal(harness.storage.activation.untilBrowserClose, false);
    assert.deepEqual(harness.getDynamicRules(), dynamicBefore);
    assert.deepEqual(harness.getSessionRules(), []);
  }
  await harness.send({ type: 'reqkit:activation:set-duration', untilBrowserClose: true });
  const sessionBefore = harness.getSessionRules();
  harness.failNextRuleUpdate('dynamic');
  const rejected = await harness.send({ type: 'reqkit:activation:set-duration', durationMs: 60_000 });
  assert.equal(rejected.ok, false);
  assert.deepEqual(harness.getSessionRules(), sessionBefore);
  assert.deepEqual(harness.getDynamicRules(), []);
  const timed = await harness.send({ type: 'reqkit:activation:set-duration', durationMs: 60_000 });
  assert.equal(timed.ok, true);
  assert.equal(harness.getDynamicRules().length, 1);
  assert.equal(harness.getSessionRules().length, 0);
  const expiry = timed.activation.expiresAt;
  chrome.runtime.onStartup.emit();
  const snapshot = await harness.send({ type: 'reqkit:state:get' });
  assert.equal(snapshot.activation.expiresAt, expiry);
  assert.equal(snapshot.activation.profileId, 'default');
});

test('regex quota is checked before changing either applied ruleset', async (t) => {
  const harness = await worker(t);
  chrome.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES = 1;
  await harness.send({ type: 'reqkit:rules:add', draft: { domain: 'example.com', headerName: 'X-One', headerValue: 'one' }, profileId: 'default' });
  await harness.send({ type: 'reqkit:activation:set-duration', untilBrowserClose: true });
  const before = harness.getSessionRules();
  const rejected = await harness.send({ type: 'reqkit:rules:add', draft: { domain: 'example.com', headerName: 'X-Two', headerValue: 'two' }, profileId: 'default' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /at most 1 active header rules/);
  assert.deepEqual(harness.getSessionRules(), before);
  assert.deepEqual(harness.getDynamicRules(), []);
  assert.equal(harness.storage.headerRules.length, 1);
});
