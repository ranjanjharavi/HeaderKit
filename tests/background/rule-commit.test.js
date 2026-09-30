import assert from 'node:assert/strict';
import test from 'node:test';

import { commitRuleSet } from '../../extension/background/rule-commit.js';

const previousRules = [{
  id: 1,
  domain: 'old.example.com',
  headerName: 'X-Old',
  headerValue: 'old',
  enabled: true
}];

const nextRules = [{
  id: 2,
  domain: 'new.example.com',
  headerName: 'X-New',
  headerValue: 'new',
  enabled: true
}];

const normalizedNextRules = [{
  ...nextRules[0],
  pathPrefix: '',
  resourceType: 'all',
  profileId: 'default'
}];

test('commitRuleSet applies and stores normalized rules', async () => {
  const applied = [];
  const stored = [];

  const result = await commitRuleSet(nextRules, {
    getCurrentRules: async () => previousRules,
    applyRules: async (rules) => applied.push(rules),
    storeRules: async (rules) => stored.push(rules)
  });

  assert.deepEqual(result, normalizedNextRules);
  assert.deepEqual(applied, [normalizedNextRules]);
  assert.deepEqual(stored, [normalizedNextRules]);
});

test('commitRuleSet restores dynamic rules when storage fails', async () => {
  const applied = [];
  const storageError = new Error('Storage failed');

  await assert.rejects(commitRuleSet(nextRules, {
    getCurrentRules: async () => previousRules,
    applyRules: async (rules) => applied.push(rules),
    storeRules: async () => {
      throw storageError;
    }
  }), storageError);

  assert.deepEqual(applied, [normalizedNextRules, previousRules]);
});

test('commitRuleSet permits the same header in different profiles', async () => {
  const applied = [];
  const profiledRules = [
    { ...nextRules[0], profileId: 'staging' },
    { ...nextRules[0], id: 3, headerValue: 'different', profileId: 'prod' }
  ];

  const result = await commitRuleSet(profiledRules, {
    activation: { masterEnabled: true, profileId: 'staging' },
    getCurrentRules: async () => previousRules,
    applyRules: async (rules) => applied.push(rules),
    storeRules: async () => {}
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((rule) => rule.profileId), ['staging', 'prod']);
  assert.equal(applied.length, 1);
});

test('commitRuleSet permits different request scopes for the same header', async () => {
  const scopedRules = [
    { ...nextRules[0], pathPrefix: '/api' },
    { ...nextRules[0], id: 3, headerValue: 'different', pathPrefix: '/admin' }
  ];

  const result = await commitRuleSet(scopedRules, {
    getCurrentRules: async () => previousRules,
    applyRules: async () => {},
    storeRules: async () => {}
  });

  assert.deepEqual(result.map((rule) => rule.pathPrefix), ['/api', '/admin']);
});

test('commitRuleSet rejects duplicate rules with the same request scope', async () => {
  let applied = false;
  const conflictingRules = [
    { ...nextRules[0], profileId: 'staging' },
    { ...nextRules[0], id: 3, headerValue: 'different', profileId: 'staging' }
  ];

  await assert.rejects(commitRuleSet(conflictingRules, {
    activation: { masterEnabled: true, profileId: 'staging' },
    getCurrentRules: async () => previousRules,
    applyRules: async () => {
      applied = true;
    },
    storeRules: async () => {}
  }), /X-New already exists.*in this profile/);

  assert.equal(applied, false);
});

test('commitRuleSet repairs unknown profiles instead of dropping rules', async () => {
  const result = await commitRuleSet([{ ...nextRules[0], profileId: 'deleted-profile' }], {
    profileIds: new Set(['default', 'staging']),
    getCurrentRules: async () => previousRules,
    applyRules: async () => {},
    storeRules: async () => {}
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].profileId, 'default');
});

test('commitRuleSet rejects malformed rule collections before applying them', async () => {
  let applied = false;

  await assert.rejects(commitRuleSet([{ id: 1, domain: '', headerName: '', headerValue: '' }], {
    getCurrentRules: async () => previousRules,
    applyRules: async () => {
      applied = true;
    },
    storeRules: async () => {}
  }), /invalid/);

  await assert.rejects(commitRuleSet([{
    id: 1,
    domain: 'example.com',
    headerName: 'Bad Header',
    headerValue: 'value'
  }], {
    getCurrentRules: async () => previousRules,
    applyRules: async () => {
      applied = true;
    },
    storeRules: async () => {}
  }), /invalid/);

  assert.equal(applied, false);
});

test('commitRuleSet rejects duplicate headers before applying them', async () => {
  let applied = false;
  const conflictingRules = [
    nextRules[0],
    {
      ...nextRules[0],
      id: 3,
      headerValue: 'different'
    }
  ];

  await assert.rejects(commitRuleSet(conflictingRules, {
    getCurrentRules: async () => previousRules,
    applyRules: async () => {
      applied = true;
    },
    storeRules: async () => {}
  }), /X-New already exists.*in this profile/);

  assert.equal(applied, false);
});
