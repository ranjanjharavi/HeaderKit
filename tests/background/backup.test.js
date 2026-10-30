import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { exportBackup, importBackup } from '../../extension/shared/runtime/backup-api.js';
import { createBackupFixture } from '../helpers/backup.js';
import { installBackgroundHarness } from '../helpers/background-harness.js';

async function worker(t, stored = {}) {
  const originalChrome = globalThis.chrome;
  const errors = t.mock.method(console, 'error', () => {});
  const { profiles, rules } = createBackupFixture();
  const storage = {
    profiles,
    headerRules: rules,
    activation: createDefaultActivation(),
    privacyConsentVersion: 2,
    ...stored
  };
  const origins = ['https://api.example.com/*'];
  const requested = [];
  const removed = [];
  let grantReads = 0;
  let failWrite = false;
  const chromeApi = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(structuredClone(Object.fromEntries(keys.map((key) => [key, storage[key]]))));
        },
        set(value, callback) {
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
      }
    },
    permissions: {
      getAll(callback) {
        grantReads++;
        callback({ origins: [...origins] });
      },
      request(details, callback) {
        requested.push(details);
        callback(false);
      },
      remove(details, callback) {
        removed.push(details);
        callback(true);
      }
    }
  };
  t.after(async () => {
    // Let non-blocking badge refreshes finish before restoring the global API.
    await new Promise(setImmediate);
    globalThis.chrome = originalChrome;
  });
  const harness = await installBackgroundHarness(chromeApi);
  return {
    ...harness,
    storage,
    origins,
    requested,
    removed,
    errors,
    get grantReads() {
      return grantReads;
    },
    failNextWrite() {
      failWrite = true;
    },
    send: (message) => new Promise((resolve) => chromeApi.runtime.sendMessage(message, resolve))
  };
}

function assertNoBackupPayloadLogged(harness) {
  assert.ok(harness.errors.mock.callCount() > 0);
  const logged = inspect(
    harness.errors.mock.calls.map((call) => call.arguments),
    { depth: null }
  );
  assert.doesNotMatch(logged, /backup-test-secret|Authorization|api\.example\.com/);
}

test('worker exports stored data without resolving expired activation, reading grants, or changing state', async (t) => {
  const harness = await worker(t, {
    activation: { ...createDefaultActivation(), expiresAt: 1, durationMs: 60_000 }
  });
  const before = structuredClone(harness.storage);
  const exported = JSON.parse(await exportBackup());
  assert.deepEqual(exported.profiles, before.profiles);
  assert.deepEqual(exported.rules, before.headerRules);
  assert.deepEqual(Object.keys(exported).sort(), ['exportedAt', 'format', 'profiles', 'rules', 'version']);
  assert.equal(exported.format, 'headerkit');
  assert.equal(exported.version, 1);
  assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
  assert.deepEqual(harness.storage, before);
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.grantReads, 0);
  assert.deepEqual(harness.requested, []);
  assert.deepEqual(harness.getDynamicRules(), []);
  assert.deepEqual(harness.getSessionRules(), []);
});

test('worker exports a fresh install using a default profile without writing it to storage', async (t) => {
  const harness = await worker(t, { profiles: undefined, headerRules: undefined });
  const exported = JSON.parse(await exportBackup());
  assert.deepEqual(exported.profiles, [{ id: 'default', name: 'Default', createdAt: 0, defaultDurationMs: null }]);
  assert.deepEqual(exported.rules, []);
  assert.deepEqual(harness.writes, []);
});

test('worker import adds paused copies atomically and leaves saved data, activation, grants, and applied rules intact', async (t) => {
  const harness = await worker(t);
  assert.equal((await harness.send({ type: 'headerkit:activation:set-master', enabled: true })).ok, true);
  const before = structuredClone(harness.storage);
  const dynamicBefore = harness.getDynamicRules();
  const writeCount = harness.writes.length;
  const backup = createBackupFixture();

  assert.deepEqual(await importBackup(JSON.stringify(backup)), { profileCount: 2, ruleCount: 3 });
  assert.deepEqual(harness.storage.profiles.slice(0, 2), before.profiles);
  assert.deepEqual(harness.storage.headerRules.slice(0, 3), before.headerRules);
  assert.deepEqual(harness.storage.activation, before.activation);
  assert.equal(harness.storage.privacyConsentVersion, before.privacyConsentVersion);
  assert.deepEqual(harness.getDynamicRules(), dynamicBefore);
  assert.deepEqual(harness.getSessionRules(), []);
  assert.deepEqual(harness.origins, ['https://api.example.com/*']);
  assert.deepEqual(harness.requested, []);
  assert.deepEqual(harness.removed, []);
  assert.equal(harness.writes.length, writeCount + 1);
  assert.deepEqual(Object.keys(harness.writes.at(-1)).sort(), ['activation', 'headerRules', 'profiles']);

  const importedProfiles = harness.storage.profiles.slice(2);
  const importedRules = harness.storage.headerRules.slice(3);
  assert.deepEqual(
    importedProfiles.map((profile) => profile.name),
    ['Default (imported)', 'QA (imported)']
  );
  assert.deepEqual(
    importedRules.map((rule) => rule.id),
    [10, 11, 12]
  );
  importedRules.forEach((rule, index) => {
    const source = backup.rules[index];
    const profileIndex = backup.profiles.findIndex((profile) => profile.id === source.profileId);
    assert.deepEqual(rule, { ...source, id: rule.id, profileId: importedProfiles[profileIndex].id, enabled: false });
  });

  const firstImport = structuredClone(harness.storage);
  assert.deepEqual(await importBackup(JSON.stringify(backup)), { profileCount: 2, ruleCount: 3 });
  assert.deepEqual(harness.storage.profiles.slice(0, 4), firstImport.profiles);
  assert.deepEqual(harness.storage.headerRules.slice(0, 6), firstImport.headerRules);
  assert.deepEqual(
    harness.storage.profiles.slice(4).map((profile) => profile.name),
    ['Default (imported 2)', 'QA (imported 2)']
  );
  assert.equal(new Set(harness.storage.profiles.map((profile) => profile.id)).size, 6);
  assert.equal(new Set(harness.storage.headerRules.map((rule) => rule.id)).size, 9);
  assert.ok(harness.storage.headerRules.slice(3).every((rule) => !rule.enabled));
  assert.deepEqual(harness.requested, []);
});

test('worker export queued after an import includes the committed copies', async (t) => {
  const harness = await worker(t);
  const [result, text] = await Promise.all([importBackup(JSON.stringify(createBackupFixture())), exportBackup()]);
  assert.deepEqual(result, { profileCount: 2, ruleCount: 3 });
  const exported = JSON.parse(text);
  assert.deepEqual(exported.profiles, harness.storage.profiles);
  assert.deepEqual(exported.rules, harness.storage.headerRules);
  assert.equal(exported.profiles.length, 4);
  assert.equal(exported.rules.length, 6);
});

test('invalid imports are rejected before loading or writing state and never log backup contents', async (t) => {
  const harness = await worker(t, {
    activation: { ...createDefaultActivation(), expiresAt: 1, durationMs: 60_000 }
  });
  const before = structuredClone(harness.storage);
  const invalid = createBackupFixture();
  invalid.rules[0].profileId = 'missing';
  for (const text of ['not JSON', JSON.stringify(invalid)]) {
    await assert.rejects(importBackup(text));
    assert.deepEqual(harness.storage, before);
    assert.deepEqual(harness.writes, []);
    assert.deepEqual(harness.getDynamicRules(), []);
    assert.deepEqual(harness.getSessionRules(), []);
  }
  assert.equal(harness.grantReads, 0);
  assert.deepEqual(harness.requested, []);
  assertNoBackupPayloadLogged(harness);
});

for (const mode of ['dynamic', 'session']) {
  for (const failure of ['api', 'storage']) {
    test(`worker preserves ${mode} rules and stored data after an import ${failure} failure`, async (t) => {
      const harness = await worker(t);
      assert.equal((await harness.send({ type: 'headerkit:activation:set-master', enabled: true })).ok, true);
      if (mode === 'session') {
        assert.equal(
          (await harness.send({ type: 'headerkit:activation:set-duration', untilBrowserClose: true })).ok,
          true
        );
      }
      const before = structuredClone(harness.storage);
      const dynamicBefore = harness.getDynamicRules();
      const sessionBefore = harness.getSessionRules();
      const writeCount = harness.writes.length;
      if (failure === 'api') {
        harness.failNextRuleUpdate(mode);
      } else {
        harness.failNextWrite();
      }
      await assert.rejects(importBackup(JSON.stringify(createBackupFixture())), {
        message: failure === 'api' ? 'Rule update failed' : 'Storage failed'
      });
      assert.deepEqual(harness.storage, before);
      assert.equal(harness.writes.length, writeCount);
      assert.deepEqual(harness.getDynamicRules(), dynamicBefore);
      assert.deepEqual(harness.getSessionRules(), sessionBefore);
      assert.deepEqual(harness.requested, []);
      assert.deepEqual(harness.removed, []);
      assertNoBackupPayloadLogged(harness);

      // A failed transaction must not poison the queue or prevent a retry.
      assert.deepEqual(await importBackup(JSON.stringify(createBackupFixture())), { profileCount: 2, ruleCount: 3 });
    });
  }
}

test('worker rejects invalid export data without logging stored header values', async (t) => {
  const { rules } = createBackupFixture();
  rules[0].headerValue += '\n';
  const harness = await worker(t, { headerRules: rules });
  const before = structuredClone(harness.storage);
  await assert.rejects(exportBackup(), /control characters/);
  assert.deepEqual(harness.storage, before);
  assert.deepEqual(harness.writes, []);
  assertNoBackupPayloadLogged(harness);
});

test('worker reports export storage failures without changing data or logging stored values', async (t) => {
  const harness = await worker(t);
  const before = structuredClone(harness.storage);
  chrome.storage.local.get = (_keys, callback) => {
    chrome.runtime.lastError = { message: 'Storage unavailable' };
    callback();
    chrome.runtime.lastError = null;
  };
  await assert.rejects(exportBackup(), { message: 'Storage unavailable' });
  assert.deepEqual(harness.storage, before);
  assert.deepEqual(harness.writes, []);
  assertNoBackupPayloadLogged(harness);
});

test('worker rejects backup requests from untrusted senders without exposing or changing data', async (t) => {
  const harness = await worker(t);
  const before = structuredClone(harness.storage);
  const reads = t.mock.method(chrome.storage.local, 'get');
  for (const sender of [
    { id: 'another-extension', url: chrome.runtime.getURL('options/index.html') },
    { id: chrome.runtime.id, url: 'https://example.com/' }
  ]) {
    for (const message of [
      { type: 'headerkit:backup:export' },
      { type: 'headerkit:backup:import', text: JSON.stringify(createBackupFixture()) }
    ]) {
      assert.equal(await harness.sendFrom(message, sender), undefined);
    }
  }
  assert.equal(reads.mock.callCount(), 0);
  assert.deepEqual(harness.storage, before);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.requested, []);
});
