import assert from 'node:assert/strict';
import test from 'node:test';
import { createStateStore } from '../../extension/background/state-store.js';
import { CURRENT_SCHEMA_VERSION, MIGRATED_KEYS } from '../../extension/background/migrate.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { createBackupFixture } from '../helpers/backup.js';

function changesFor(values) {
  return Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
}

function setup(overrides = {}) {
  const { profiles, rules } = createBackupFixture();
  const storage = { profiles, headerRules: rules, activation: createDefaultActivation(), ...overrides.stored };
  const reads = [];
  const writes = [];
  const errors = [];
  let grantReads = 0;
  const store = createStateStore({
    get:
      overrides.get ??
      (async (keys) => {
        reads.push([...keys]);
        return structuredClone(Object.fromEntries(keys.map((key) => [key, storage[key]])));
      }),
    set:
      overrides.set ??
      (async (values) => {
        writes.push(structuredClone(values));
        Object.assign(storage, structuredClone(values));
        store.handleStorageChanges(changesFor(values), 'local');
      }),
    getGrantedOrigins: async () => {
      grantReads++;
      return overrides.getGrantedOrigins ? overrides.getGrantedOrigins() : new Set(['https://api.example.com/*']);
    },
    onError: (...args) => errors.push(args)
  });
  return {
    store,
    storage,
    reads,
    writes,
    errors,
    get grantReads() {
      return grantReads;
    }
  };
}

test('store instances normalize their own snapshots without sharing a cache or doing eager IO', async () => {
  const first = setup({ stored: { profiles: undefined, headerRules: undefined, activation: undefined } });
  const second = setup();
  assert.deepEqual(first.reads, []);
  assert.equal(first.store.peek(), null);
  const state = await first.store.load();
  assert.deepEqual(state.rules, []);
  assert.deepEqual([...state.profileIds], ['default']);
  assert.deepEqual(state.activation, createDefaultActivation());
  assert.equal(first.store.peek(), state);
  assert.deepEqual(first.reads, [MIGRATED_KEYS]);
  await first.store.load();
  assert.equal(first.reads.length, 1);
  assert.equal(first.grantReads, 1);
  assert.equal(second.store.peek(), null);
  assert.deepEqual(second.reads, []);
  assert.equal((await second.store.load()).rules.length, 3);
});

test('committed writes and equivalent delayed storage events do not invalidate a warm cache', async () => {
  const harness = setup();
  const state = await harness.store.load();
  const rules = state.rules.map((rule) => ({ ...rule, headerValue: 'updated' }));
  await harness.store.storeRules(rules);
  const reordered = rules.map((rule) => Object.fromEntries(Object.entries(rule).reverse()));
  harness.store.handleStorageChanges(changesFor({ headerRules: reordered }), 'local');
  harness.store.handleStorageChanges(changesFor({ activation: {} }), 'sync');
  assert.deepEqual((await harness.store.load()).rules, rules);
  assert.equal(harness.reads.length, 1);
  assert.deepEqual(harness.writes, [{ headerRules: rules }]);
});

test('full state writes refresh derived profile IDs and keep storage writes atomic', async () => {
  const harness = setup();
  const state = await harness.store.load();
  const profiles = [...state.profiles, { id: 'new', name: 'New', createdAt: 0, defaultDurationMs: null }];
  await harness.store.storeState({ ...state, profiles, profileIds: new Set(['stale']) });
  assert.deepEqual([...harness.store.peek().profileIds], ['default', 'qa', 'new']);
  assert.deepEqual(Object.keys(harness.writes[0]).sort(), ['activation', 'headerRules', 'profiles']);
  assert.equal(harness.reads.length, 1);
});

test('a cold partial write is read back rather than inventing the rest of a cached state', async () => {
  const harness = setup();
  await harness.store.storeRules([]);
  assert.equal(harness.store.peek(), null);
  assert.deepEqual((await harness.store.load()).rules, []);
  assert.equal(harness.reads.length, 1);
});

test('external storage changes invalidate cached values even when the changed shape is different', async () => {
  const harness = setup();
  await harness.store.load();
  const updates = [
    { headerRules: [] },
    { headerRules: {} },
    { headerRules: [{ id: 1 }] },
    { activation: null },
    { profiles: [{ id: 'default', name: 'Changed', createdAt: 0, defaultDurationMs: null }] },
    { unrelated: 42 }
  ];
  for (const values of updates) {
    Object.assign(harness.storage, structuredClone(values));
    harness.store.handleStorageChanges(changesFor(values), 'local');
    assert.equal(harness.store.peek(), null);
    await harness.store.load();
  }
  assert.equal(harness.reads.length, updates.length + 1);
});

test('explicit invalidation retries grants and storage rather than returning the previous snapshot', async () => {
  const harness = setup();
  const before = await harness.store.load();
  harness.store.invalidate();
  assert.equal(harness.store.peek(), null);
  const after = await harness.store.load();
  assert.notEqual(after, before);
  assert.equal(harness.reads.length, 2);
  assert.equal(harness.grantReads, 2);
});

test('grant read failures return unknown grants without retaining an incomplete cache', async () => {
  const error = new Error('Permissions unavailable');
  let fail = true;
  const harness = setup({
    getGrantedOrigins: async () => {
      if (fail) throw error;
      return new Set(['https://api.example.com/*']);
    }
  });
  const state = await harness.store.load();
  assert.equal(state.grantedOrigins, null);
  assert.equal(harness.store.peek(), null);
  await harness.store.storeState(state);
  assert.equal(harness.store.peek(), null);
  assert.deepEqual(harness.errors, [['Could not read granted site access.', error]]);
  fail = false;
  assert.ok((await harness.store.load()).grantedOrigins instanceof Set);
  await harness.store.load();
  assert.equal(harness.grantReads, 2);
});

test('a storage invalidation during a cold read cannot publish a stale snapshot', async () => {
  let release;
  let started;
  const readStarted = new Promise((resolve) => {
    started = resolve;
  });
  let reads = 0;
  const harness = setup({
    get: async () => {
      reads++;
      const value = structuredClone(harness.storage);
      if (reads === 1) {
        await new Promise((resolve) => {
          release = resolve;
          started();
        });
      }
      return value;
    }
  });
  const loading = harness.store.load();
  await readStarted;
  harness.storage.activation.masterEnabled = false;
  harness.store.handleStorageChanges(changesFor({ activation: harness.storage.activation }), 'local');
  release();
  assert.equal((await loading).activation.masterEnabled, false);
  assert.equal(harness.store.peek().activation.masterEnabled, false);
  assert.equal(reads, 2);
});

test('an invalidation during a pending write prevents stale next-state publication', async () => {
  let release;
  const harness = setup({
    set: () =>
      new Promise((resolve) => {
        release = resolve;
      })
  });
  const state = await harness.store.load();
  const nextRules = [];
  const saving = harness.store.storeRules(nextRules);
  harness.storage.activation.masterEnabled = false;
  harness.store.handleStorageChanges(changesFor({ activation: harness.storage.activation }), 'local');
  harness.storage.headerRules = nextRules;
  release();
  await saving;
  assert.equal(harness.store.peek(), null);
  const current = await harness.store.load();
  assert.equal(current.activation.masterEnabled, false);
  assert.deepEqual(current.rules, []);
});

test('failed writes retain the old cache and remove their pending-write exemption', async () => {
  const failure = new Error('Storage failed');
  const harness = setup({
    set: async () => {
      throw failure;
    }
  });
  const state = await harness.store.load();
  await assert.rejects(harness.store.storeRules([]), (error) => error === failure);
  assert.equal(harness.store.peek(), state);
  harness.storage.headerRules = [];
  harness.store.handleStorageChanges(changesFor({ headerRules: [] }), 'local');
  assert.equal(harness.store.peek(), null);
  assert.deepEqual((await harness.store.load()).rules, []);
});

test('peek hides expired cache entries and load persists expiry before publishing the parked state', async (t) => {
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const harness = setup({
    stored: { activation: { ...createDefaultActivation(), expiresAt: 20_000, durationMs: 10_000 } }
  });
  await harness.store.load();
  assert.ok(harness.store.peek());
  now = 20_000;
  assert.equal(harness.store.peek(), null);
  const expired = await harness.store.load();
  assert.equal(expired.activation.profileId, null);
  assert.equal(harness.storage.activation.expiresAt, null);
  assert.deepEqual(harness.writes, [{ activation: expired.activation }]);
  assert.equal(harness.reads.length, 1);
});

test('a failed expiry write does not publish a state that was never persisted', async (t) => {
  t.mock.method(Date, 'now', () => 10_000);
  const failure = new Error('Expiry persistence failed');
  const harness = setup({
    stored: { activation: { ...createDefaultActivation(), expiresAt: 1, durationMs: 1000 } },
    set: async () => {
      throw failure;
    }
  });
  await assert.rejects(harness.store.load(), (error) => error === failure);
  assert.equal(harness.store.peek(), null);
  assert.equal(harness.storage.activation.profileId, 'default');
});

test('new-browser-session loading bypasses a warm cache and persists session-only deactivation', async () => {
  const harness = setup({ stored: { activation: { ...createDefaultActivation(), untilBrowserClose: true } } });
  await harness.store.load();
  const restarted = await harness.store.load({ newBrowserSession: true });
  assert.equal(restarted.activation.profileId, null);
  assert.equal(restarted.activation.untilBrowserClose, false);
  assert.equal(harness.reads.length, 2);
  assert.deepEqual(harness.writes, [{ activation: restarted.activation }]);
});

test('backup reads preserve raw invalid values without resolving expiry or reading grants', async () => {
  const harness = setup({ stored: { activation: { ...createDefaultActivation(), expiresAt: 1, durationMs: 1000 } } });
  harness.storage.headerRules[0].headerValue = 'invalid\nsecret';
  const before = structuredClone(harness.storage);
  const data = await harness.store.readBackupData();
  assert.deepEqual(data, { profiles: before.profiles, rules: before.headerRules });
  assert.deepEqual(harness.reads, [['profiles', 'headerRules']]);
  assert.equal(harness.grantReads, 0);
  assert.deepEqual(harness.writes, []);
  assert.equal(harness.store.peek(), null);
});

test('backup reads provide fresh-install defaults and migrations still use the existing schema steps', async () => {
  const harness = setup({ stored: { profiles: undefined, headerRules: undefined } });
  const data = await harness.store.readBackupData();
  assert.deepEqual(data.profiles, [{ id: 'default', name: 'Default', createdAt: 0, defaultDurationMs: null }]);
  assert.deepEqual(data.rules, []);
  await harness.store.migrate();
  assert.equal(harness.storage.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(harness.writes.at(-1), { schemaVersion: CURRENT_SCHEMA_VERSION });
});
