import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  ensureMigrated,
  migrateState
} from '../extension/background/migrate.js';

const legacyState = {
  headerRules: [
    { id: 1, domain: 'api.example.com', headerName: 'X-Auth', headerValue: 'one', enabled: true },
    { id: 2, domain: 'other.example.com', headerName: 'X-Debug', headerValue: 'two', enabled: false }
  ]
};

function createStorageStub(initial = {}) {
  const data = { ...initial };
  const writes = [];

  return {
    data,
    writes,
    get: async (keys) => Object.fromEntries(
      keys.filter((key) => key in data).map((key) => [key, data[key]])
    ),
    set: async (value) => {
      writes.push(value);
      Object.assign(data, value);
    }
  };
}

test('a 1.0 profile keeps every rule exactly as it was', () => {
  const { state, changed, fromVersion } = migrateState(legacyState);

  assert.equal(changed, true);
  assert.equal(fromVersion, 0);
  assert.equal(state[SCHEMA_VERSION_KEY], CURRENT_SCHEMA_VERSION);

  assert.deepEqual(state.headerRules.map((rule) => rule.enabled), [true, false]);
  assert.deepEqual(state.headerRules.map((rule) => rule.id), [1, 2]);
  assert.deepEqual(state.headerRules.map((rule) => rule.headerValue), ['one', 'two']);
  assert.deepEqual(state.headerRules.map((rule) => rule.profileId), ['default', 'default']);
});

test('migration leaves the extension switched on', () => {
  const { state } = migrateState(legacyState);

  assert.equal(state.activation.masterEnabled, true);
  assert.equal(state.activation.profileId, 'default');
  assert.equal(state.activation.expiresAt, null);
  assert.deepEqual(state.profiles.map((profile) => profile.id), ['default']);
});

test('a fresh install seeds the default profile', () => {
  const { state, changed } = migrateState({});

  assert.equal(changed, true);
  assert.deepEqual(state.headerRules, []);
  assert.deepEqual(state.profiles.map((profile) => profile.name), ['Default']);
  assert.equal(state.activation.profileId, 'default');
});

test('migration is idempotent', () => {
  const first = migrateState(legacyState).state;
  const second = migrateState(first);

  assert.equal(second.changed, false);
  assert.deepEqual(second.state, first);
});

test('an already-migrated profile is left untouched', () => {
  const migrated = {
    [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION,
    profiles: [{ id: 'staging', name: 'Staging', createdAt: 5, defaultDurationMs: null }],
    headerRules: [],
    activation: { masterEnabled: false, profileId: 'staging', lastProfileId: 'staging', expiresAt: null, untilBrowserClose: false }
  };

  const { state, changed } = migrateState(migrated);

  assert.equal(changed, false);
  assert.deepEqual(state, migrated);
});

test('migration preserves unrelated keys', () => {
  const { state } = migrateState({ ...legacyState, privacyConsentVersion: 1, unrelatedPreference: 'kept' });

  assert.equal(state.privacyConsentVersion, 1);
  assert.equal(state.unrelatedPreference, 'kept');
});

test('ensureMigrated writes data before the version marker', async () => {
  const storage = createStorageStub(legacyState);

  await ensureMigrated(storage);

  assert.equal(storage.writes.length, 2);
  assert.equal(SCHEMA_VERSION_KEY in storage.writes[0], false);
  assert.deepEqual(storage.writes[1], { [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
  assert.equal(storage.data.activation.masterEnabled, true);
});

test('a failure before the version marker re-runs cleanly', async () => {
  const storage = createStorageStub(legacyState);
  let attempt = 0;
  const failingSet = async (value) => {
    attempt += 1;
    if (attempt === 2) {
      throw new Error('Storage failed');
    }
    return storage.set(value);
  };

  await assert.rejects(ensureMigrated({ get: storage.get, set: failingSet }), /Storage failed/);
  assert.equal(SCHEMA_VERSION_KEY in storage.data, false);

  await ensureMigrated(storage);
  assert.equal(storage.data[SCHEMA_VERSION_KEY], CURRENT_SCHEMA_VERSION);
  assert.deepEqual(storage.data.headerRules.map((rule) => rule.enabled), [true, false]);
});

test('ensureMigrated skips writing when nothing changed', async () => {
  const storage = createStorageStub(legacyState);
  await ensureMigrated(storage);
  const writeCount = storage.writes.length;

  await ensureMigrated(storage);
  assert.equal(storage.writes.length, writeCount);
});
