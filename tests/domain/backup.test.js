import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  mergeBackup,
  parseBackup,
  serializeBackup
} from '../../extension/shared/domain/backup.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { createProfileId, MAX_PROFILE_NAME_LENGTH } from '../../extension/shared/domain/profiles.js';
import { createBackupFixture } from '../helpers/backup.js';

function createState() {
  const { profiles, rules } = createBackupFixture();
  return {
    profiles,
    rules,
    activation: { ...createDefaultActivation(), masterEnabled: false, untilBrowserClose: true },
    grantedOrigins: new Set(['https://api.example.com/*']),
    privacyConsentVersion: 2
  };
}

test('backup serialization preserves full values, scopes, metadata and enabled flags, but excludes other state', () => {
  const backup = createBackupFixture();
  const state = createState();
  state.profiles[0].draftName = 'Unsaved profile name';
  state.rules[0].revealed = false;
  state.unsavedDraft = { headerValue: 'unsaved-secret' };
  const before = structuredClone(state);
  const text = serializeBackup(state, { now: new Date(backup.exportedAt) });

  assert.equal(BACKUP_FORMAT, 'headerkit');
  assert.equal(BACKUP_VERSION, 1);
  assert.deepEqual(JSON.parse(text), backup);
  assert.equal(JSON.parse(text).rules[0].headerValue, 'Bearer backup-test-secret');
  assert.ok(text.endsWith('\n'));
  assert.doesNotMatch(text, /activation|grantedOrigins|privacyConsentVersion|draftName|revealed|unsaved-secret/);
  assert.deepEqual(state, before);
  assert.deepEqual(parseBackup(text), backup);
});

test('serialization rejects data that could not be imported without losing it', () => {
  const backup = createBackupFixture();
  backup.rules[0].headerValue = 'invalid\nvalue';
  assert.throws(() => serializeBackup(backup), /control characters/);
});

test('parsing accepts a BOM and either canonical UTC timestamp form', () => {
  for (const exportedAt of ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00Z']) {
    const backup = { ...createBackupFixture(), exportedAt };
    assert.deepEqual(parseBackup(`\uFEFF${JSON.stringify(backup)}`), backup);
  }
});

test('parsing normalizes supported text and Unicode paths without discarding header values', () => {
  const backup = createBackupFixture();
  Object.assign(backup.rules[0], {
    domain: 'HTTPS://API.EXAMPLE.COM/',
    headerName: ' Authorization ',
    headerValue: '  Bearer café\tvalue  ',
    pathPrefix: '/café/'
  });
  backup.profiles[1].name = ' QA ';
  const parsed = parseBackup(JSON.stringify(backup));
  assert.deepEqual(parsed.rules[0], {
    ...backup.rules[0],
    domain: 'api.example.com',
    headerName: 'Authorization',
    headerValue: 'Bearer café\tvalue',
    pathPrefix: '/caf%C3%A9'
  });
  assert.equal(parsed.profiles[1].name, 'QA');
});

test('parsing accepts a profile-only backup with no rules', () => {
  const backup = { ...createBackupFixture(), rules: [] };
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup);
});

test('backup size limits count UTF-8 bytes and allow the exact limit', () => {
  const text = JSON.stringify(createBackupFixture());
  const padded = text.padEnd(MAX_BACKUP_BYTES, ' ');
  assert.deepEqual(parseBackup(padded), createBackupFixture());
  assert.throws(() => parseBackup(`${padded} `), /5 MiB/);

  const backup = { ...createBackupFixture(), extra: 'é'.repeat(MAX_BACKUP_BYTES / 2) };
  const multibyte = JSON.stringify(backup);
  assert.ok(multibyte.length < MAX_BACKUP_BYTES);
  assert.ok(new TextEncoder().encode(multibyte).byteLength > MAX_BACKUP_BYTES);
  assert.throws(() => parseBackup(multibyte), /5 MiB/);
});

test('parsing rejects non-text, invalid JSON, and invalid backup envelopes', async (t) => {
  for (const text of [undefined, null, 42, {}, []]) {
    assert.throws(() => parseBackup(text), /Choose a HeaderKit JSON backup/);
  }
  assert.throws(() => parseBackup('{broken'), /not valid JSON/);
  for (const value of [null, [], 42, {}, { format: 'other' }]) {
    assert.throws(() => parseBackup(JSON.stringify(value)), /not a HeaderKit backup/);
  }
  const cases = [
    ['unsupported version', { version: 2 }, /Unsupported backup version/],
    ['string version', { version: '1' }, /Unsupported backup version/],
    ['missing timestamp', { exportedAt: undefined }, /export timestamp/],
    ['invalid timestamp', { exportedAt: 'not-a-date' }, /export timestamp/],
    ['normalized invalid date', { exportedAt: '2026-02-30T00:00:00Z' }, /export timestamp/],
    ['non-UTC timestamp', { exportedAt: '2026-01-01T01:00:00+01:00' }, /export timestamp/],
    ['empty profiles', { profiles: [] }, /profiles and a rules list/],
    ['missing profiles', { profiles: undefined }, /profiles and a rules list/],
    ['invalid profiles', { profiles: {} }, /profiles and a rules list/],
    ['missing rules', { rules: undefined }, /profiles and a rules list/],
    ['invalid rules', { rules: {} }, /profiles and a rules list/]
  ];
  for (const [name, overrides, error] of cases) {
    await t.test(name, () => {
      assert.throws(() => parseBackup(JSON.stringify({ ...createBackupFixture(), ...overrides })), error);
    });
  }
});

test('parsing rejects malformed profiles and duplicate profile identities', async (t) => {
  const cases = [
    ['missing profile', () => null, /invalid or duplicate ID/],
    ['non-text ID', (profile) => ({ ...profile, id: 7 }), /invalid or duplicate ID/],
    ['empty ID', (profile) => ({ ...profile, id: '' }), /invalid or duplicate ID/],
    ['untrimmed ID', (profile) => ({ ...profile, id: ' qa ' }), /invalid or duplicate ID/],
    ['oversized ID', (profile) => ({ ...profile, id: 'a'.repeat(201) }), /invalid or duplicate ID/],
    ['control characters in ID', (profile) => ({ ...profile, id: 'qa\n' }), /invalid or duplicate ID/],
    ['duplicate ID', (profile) => ({ ...profile, id: 'default' }), /invalid or duplicate ID/],
    ['non-text name', (profile) => ({ ...profile, name: 7 }), /valid name/],
    ['empty name', (profile) => ({ ...profile, name: ' ' }), /Enter a name/],
    ['oversized name', (profile) => ({ ...profile, name: 'a'.repeat(41) }), /limited to 40/],
    ['case-insensitive duplicate name', (profile) => ({ ...profile, name: ' default ' }), /unique name/],
    ['invalid creation time', (profile) => ({ ...profile, createdAt: -1 }), /timing metadata/],
    ['missing creation time', (profile) => ({ ...profile, createdAt: undefined }), /timing metadata/],
    ['invalid duration', (profile) => ({ ...profile, defaultDurationMs: 0 }), /timing metadata/],
    ['non-numeric duration', (profile) => ({ ...profile, defaultDurationMs: '1000' }), /timing metadata/],
    ['missing duration', (profile) => ({ ...profile, defaultDurationMs: undefined }), /timing metadata/]
  ];
  for (const [name, change, error] of cases) {
    await t.test(name, () => {
      const backup = createBackupFixture();
      backup.profiles[1] = change(backup.profiles[1]);
      assert.throws(() => parseBackup(JSON.stringify(backup)), error);
    });
  }
});

test('parsing rejects malformed rules, unknown references and duplicate request scopes', async (t) => {
  const cases = [
    ['missing rule', () => null, /invalid or duplicate ID/],
    ['non-integer ID', (rule) => ({ ...rule, id: 1.5 }), /invalid or duplicate ID/],
    ['non-numeric ID', (rule) => ({ ...rule, id: '4' }), /invalid or duplicate ID/],
    ['zero ID', (rule) => ({ ...rule, id: 0 }), /invalid or duplicate ID/],
    ['ID above Chrome range', (rule) => ({ ...rule, id: 2_147_483_648 }), /invalid or duplicate ID/],
    ['duplicate ID', (rule) => ({ ...rule, id: 1 }), /invalid or duplicate ID/],
    ['unknown profile', (rule) => ({ ...rule, profileId: 'missing' }), /unknown profile/],
    ['non-text profile', (rule) => ({ ...rule, profileId: 7 }), /unknown profile/],
    ['invalid host', (rule) => ({ ...rule, domain: '*.example.com' }), /Wildcards are not supported/],
    ['invalid header name', (rule) => ({ ...rule, headerName: 'Bad Header' }), /valid HTTP header name/],
    ['control characters in value', (rule) => ({ ...rule, headerValue: 'secret\r\nvalue' }), /control characters/],
    ['invalid path', (rule) => ({ ...rule, pathPrefix: '/api?secret' }), /valid path prefix/],
    ['unsupported request type', (rule) => ({ ...rule, resourceType: 'script' }), /resourceType must be/],
    ['non-boolean enabled', (rule) => ({ ...rule, enabled: 'true' }), /enabled must be/],
    ['missing enabled', (rule) => ({ ...rule, enabled: undefined }), /enabled must be/]
  ];
  for (const field of ['domain', 'headerName', 'headerValue', 'pathPrefix']) {
    cases.push([`non-text ${field}`, (rule) => ({ ...rule, [field]: 7 }), new RegExp(`${field} must be text`)]);
  }
  for (const [name, change, error] of cases) {
    await t.test(name, () => {
      const backup = createBackupFixture();
      backup.rules[1] = change(backup.rules[1]);
      assert.throws(() => parseBackup(JSON.stringify(backup)), error);
    });
  }
  const backup = createBackupFixture();
  backup.rules.push({ ...backup.rules[0], id: 10, headerName: 'authorization', enabled: false, headerValue: 'other' });
  assert.throws(() => parseBackup(JSON.stringify(backup)), /duplicates a header and request scope/);
});

test('merging allocates fresh IDs, remaps profile references and pauses every imported rule without mutating inputs', () => {
  const state = createState();
  const backup = createBackupFixture();
  const stateBefore = structuredClone(state);
  const backupBefore = structuredClone(backup);
  const merged = mergeBackup(backup, state);
  const importedProfiles = merged.profiles.slice(state.profiles.length);
  const importedRules = merged.rules.slice(state.rules.length);

  assert.deepEqual(state, stateBefore);
  assert.deepEqual(backup, backupBefore);
  assert.deepEqual(merged.profiles.slice(0, state.profiles.length), state.profiles);
  assert.deepEqual(merged.rules.slice(0, state.rules.length), state.rules);
  assert.deepEqual(merged.activation, state.activation);
  assert.deepEqual(merged.grantedOrigins, state.grantedOrigins);
  assert.equal(merged.privacyConsentVersion, state.privacyConsentVersion);
  assert.deepEqual(
    importedProfiles.map((profile) => profile.name),
    ['Default (imported)', 'QA (imported)']
  );
  assert.equal(new Set(merged.profiles.map((profile) => profile.id)).size, merged.profiles.length);
  assert.deepEqual(
    importedRules.map((rule) => rule.id),
    [10, 11, 12]
  );
  importedProfiles.forEach((profile, index) => {
    assert.notEqual(profile.id, backup.profiles[index].id);
    assert.deepEqual(profile, { ...backup.profiles[index], id: profile.id, name: profile.name });
  });
  importedRules.forEach((rule, index) => {
    const source = backup.rules[index];
    const profileIndex = backup.profiles.findIndex((profile) => profile.id === source.profileId);
    assert.deepEqual(rule, { ...source, id: rule.id, profileId: importedProfiles[profileIndex].id, enabled: false });
  });
});

test('repeated imports add independent copies with case-insensitive unique names', () => {
  const state = createState();
  state.profiles[0].name = 'DEFAULT';
  const backup = createBackupFixture();
  const first = mergeBackup(backup, state);
  const second = mergeBackup(backup, first);
  assert.deepEqual(
    second.profiles.map((profile) => profile.name),
    ['DEFAULT', 'QA', 'Default (imported)', 'QA (imported)', 'Default (imported 2)', 'QA (imported 2)']
  );
  assert.equal(new Set(second.profiles.map((profile) => profile.id)).size, 6);
  assert.equal(new Set(second.rules.map((rule) => rule.id)).size, 9);
  assert.deepEqual(second.profiles.slice(0, first.profiles.length), first.profiles);
  assert.deepEqual(second.rules.slice(0, first.rules.length), first.rules);
  assert.ok(second.rules.slice(state.rules.length).every((rule) => !rule.enabled));
});

test('imported name suffixes respect the length limit without splitting Unicode surrogate pairs', () => {
  const backup = createBackupFixture();
  backup.profiles[1].name = '😀'.repeat(MAX_PROFILE_NAME_LENGTH / 2);
  const state = createState();
  state.profiles[1].name = backup.profiles[1].name;
  const merged = mergeBackup(backup, state);
  const name = merged.profiles.at(-1).name;
  assert.ok(name.length <= MAX_PROFILE_NAME_LENGTH);
  assert.equal(name, `${'😀'.repeat(14)} (imported)`);
  assert.ok(name.isWellFormed());
});

test('merging into an empty collection starts rule IDs at one and keeps unused profile names', () => {
  const state = { ...createState(), profiles: [], rules: [] };
  const backup = createBackupFixture();
  const merged = mergeBackup(backup, state);
  assert.deepEqual(
    merged.rules.map((rule) => rule.id),
    [1, 2, 3]
  );
  assert.deepEqual(
    merged.profiles.map((profile) => profile.name),
    ['Default', 'QA']
  );
});

for (const collision of ['existing profile', 'another imported profile']) {
  test(`merging rejects a generated ID collision with ${collision} without changing inputs`, (t) => {
    t.mock.method(globalThis.crypto, 'randomUUID', () => '00000000-0000-4000-8000-000000000000');
    const state = createState();
    if (collision === 'existing profile') {
      state.profiles.push({ ...state.profiles[0], id: createProfileId(), name: 'Collision' });
    }
    const backup = createBackupFixture();
    const stateBefore = structuredClone(state);
    const backupBefore = structuredClone(backup);
    assert.throws(() => mergeBackup(backup, state), /Could not allocate an imported profile/);
    assert.deepEqual(state, stateBefore);
    assert.deepEqual(backup, backupBefore);
  });
}

test('merging allows the last valid rule ID but rejects ID exhaustion without changing state', () => {
  const backup = createBackupFixture();
  backup.rules = [backup.rules[0]];
  const state = createState();
  state.rules = [{ ...state.rules[0], id: 2_147_483_646 }];
  const merged = mergeBackup(backup, state);
  assert.equal(merged.rules.at(-1).id, 2_147_483_647);
  const before = structuredClone(merged);
  assert.throws(() => mergeBackup(backup, merged), /Not enough rule IDs/);
  assert.deepEqual(merged, before);
});
