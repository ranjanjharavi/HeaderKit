import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PROFILE_ID,
  cloneRulesIntoProfile,
  countRulesInProfile,
  createDefaultProfiles,
  createProfile,
  findProfile,
  getProfileIds,
  getProfileName,
  normalizeProfiles,
  resolveProfileId,
  validateProfileDraft
} from '../../extension/shared/domain/profiles.js';

test('an empty or invalid profile list always yields the default profile', () => {
  assert.deepEqual(normalizeProfiles([]), createDefaultProfiles());
  assert.deepEqual(normalizeProfiles(null), createDefaultProfiles());
  assert.deepEqual(normalizeProfiles('nonsense'), createDefaultProfiles());
});

test('the default profile is restored when a stored list omits it', () => {
  const profiles = normalizeProfiles([{ id: 'staging', name: 'Staging' }]);

  assert.deepEqual(
    profiles.map((profile) => profile.id),
    [DEFAULT_PROFILE_ID, 'staging']
  );
});

test('normalizeProfiles drops duplicates and repairs fields', () => {
  const profiles = normalizeProfiles([
    { id: 'staging', name: '  Staging  ' },
    { id: 'staging', name: 'Duplicate' },
    { id: 'prod', name: '', defaultDurationMs: -1 },
    { id: 'qa', name: 'QA', defaultDurationMs: 3600000 }
  ]);

  assert.deepEqual(
    profiles.map((profile) => profile.id),
    [DEFAULT_PROFILE_ID, 'staging', 'prod', 'qa']
  );
  assert.equal(findProfile(profiles, 'staging').name, 'Staging');
  assert.equal(findProfile(profiles, 'prod').name, 'prod');
  assert.equal(findProfile(profiles, 'prod').defaultDurationMs, null);
  assert.equal(findProfile(profiles, 'qa').defaultDurationMs, 3600000);
});

test('an empty profile reference resolves to the default profile', () => {
  assert.equal(resolveProfileId(''), DEFAULT_PROFILE_ID);
  assert.equal(resolveProfileId(undefined), DEFAULT_PROFILE_ID);
  assert.equal(resolveProfileId('  staging  '), 'staging');
});

test('profile lookup helpers agree with each other', () => {
  const profiles = normalizeProfiles([{ id: 'staging', name: 'Staging' }]);

  assert.equal(findProfile(profiles, 'staging'), profiles[1]);
  assert.equal(findProfile(profiles, 'missing'), null);
  assert.equal(getProfileName(profiles, 'staging'), 'Staging');
  assert.equal(getProfileName(profiles, 'missing'), 'Default');
  assert.deepEqual([...getProfileIds(profiles)].sort(), ['default', 'staging']);
});

test('profile names must be present and unique', () => {
  const profiles = normalizeProfiles([{ id: 'staging', name: 'Staging' }]);

  assert.equal(validateProfileDraft({ name: 'Prod' }, profiles).ok, true);
  assert.equal(validateProfileDraft({ name: '  ' }, profiles).ok, false);
  assert.match(validateProfileDraft({ name: 'staging' }, profiles).error, /already exists/);
  assert.equal(validateProfileDraft({ name: 'Staging' }, profiles, { excludeId: 'staging' }).ok, true);
  assert.match(validateProfileDraft({ name: 'x'.repeat(41) }, profiles).error, /40 characters/);
});

test('creating a profile trims and caps the name', () => {
  const profile = createProfile('  Staging  ', { now: 1234 });

  assert.equal(profile.name, 'Staging');
  assert.equal(profile.createdAt, 1234);
  assert.equal(profile.defaultDurationMs, null);
  assert.match(profile.id, /^profile-/);
});

test('cloning copies only the source profile and renumbers ids', () => {
  const rules = [
    { id: 1, domain: 'a.example.com', headerName: 'X-A', headerValue: '1', enabled: true, profileId: 'staging' },
    { id: 2, domain: 'b.example.com', headerName: 'X-B', headerValue: '2', enabled: false, profileId: 'staging' },
    { id: 3, domain: 'c.example.com', headerName: 'X-C', headerValue: '3', enabled: true, profileId: 'default' }
  ];

  const cloned = cloneRulesIntoProfile(rules, 'staging', 'prod', 4);

  assert.deepEqual(
    cloned.map((rule) => rule.id),
    [4, 5]
  );
  assert.deepEqual(
    cloned.map((rule) => rule.profileId),
    ['prod', 'prod']
  );
  assert.deepEqual(
    cloned.map((rule) => rule.headerValue),
    ['1', '2']
  );
  assert.deepEqual(
    rules.map((rule) => rule.id),
    [1, 2, 3],
    'source rules untouched'
  );
});

test('rules are counted per profile, treating a missing profile as default', () => {
  const rules = [{ id: 1, profileId: 'staging' }, { id: 2, profileId: 'default' }, { id: 3 }];

  assert.equal(countRulesInProfile(rules, 'staging'), 1);
  assert.equal(countRulesInProfile(rules, 'default'), 2);
});
