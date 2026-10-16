import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRuleIntent, commitRuleSet } from '../../extension/background/rule-commit.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { createSerialQueue } from '../../extension/shared/runtime/serial-queue.js';
import {
  RULE_MESSAGE_ADD,
  RULE_MESSAGE_UPDATE,
  RULE_MESSAGE_SET_ENABLED,
  RULE_MESSAGE_DELETE
} from '../../extension/shared/runtime/messages.js';

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

test('commitRuleSet rejects unknown profiles instead of reviving rules in Default', async () => {
  await assert.rejects(commitRuleSet([{ ...nextRules[0], profileId: 'deleted-profile' }], {
    profileIds: new Set(['default', 'staging']),
    getCurrentRules: async () => previousRules,
    applyRules: async () => {},
    storeRules: async () => {}
  }), /profile no longer exists/);
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

function intentState(rules = []) {
  return {
    rules,
    activation: createDefaultActivation(),
    profileIds: new Set(['default', 'staging'])
  };
}

test('serialized add intents allocate distinct ids without losing either addition', async () => {
  const enqueue = createSerialQueue();
  let state = intentState();
  const add = (draft) => enqueue(async () => {
    const result = applyRuleIntent({ type: RULE_MESSAGE_ADD, draft, profileId: 'default' }, state);
    const rules = await commitRuleSet(result.rules, {
      profileIds: state.profileIds,
      getCurrentRules: async () => state.rules,
      applyRules: async () => {},
      storeRules: async () => {}
    });
    state = { ...state, rules };
    return result.rule;
  });
  const added = await Promise.all([add(previousRules[0]), add(nextRules[0])]);
  assert.deepEqual(added.map((rule) => rule.id), [1, 2]);
  assert.equal(state.rules.length, 2);
});

test('rule update, set-enabled and delete intents preserve unrelated current rules', () => {
  let state = intentState([
    { ...previousRules[0], profileId: 'default' },
    { ...nextRules[0], profileId: 'default' }
  ]);
  const updated = applyRuleIntent({
    type: RULE_MESSAGE_UPDATE,
    id: 1,
    draft: { ...previousRules[0], headerValue: 'updated' },
    profileId: 'default'
  }, state);
  state = { ...state, rules: updated.rules };
  const paused = applyRuleIntent({ type: RULE_MESSAGE_SET_ENABLED, id: 2, enabled: false, profileId: 'staging' }, state);
  state = { ...state, rules: paused.rules };
  const deleted = applyRuleIntent({ type: RULE_MESSAGE_DELETE, id: 1 }, state);
  assert.equal(updated.rule.headerValue, 'updated');
  assert.equal(updated.rules[1].headerValue, 'new');
  assert.equal(paused.rule.enabled, false);
  assert.equal(paused.rule.profileId, 'default');
  assert.deepEqual(deleted.rules, [paused.rule]);
  assert.throws(() => applyRuleIntent({ type: RULE_MESSAGE_UPDATE, id: 1 }, { ...state, rules: deleted.rules }), /rule no longer exists/);
});

test('rule intents reject duplicates, overlapping live values, and unknown profiles', () => {
  const rule = { ...previousRules[0], profileId: 'default', pathPrefix: '', resourceType: 'all' };
  const state = intentState([rule]);
  assert.throws(() => applyRuleIntent({ type: RULE_MESSAGE_ADD, draft: rule, profileId: 'default' }, state), /already exists/);
  assert.throws(() => applyRuleIntent({
    type: RULE_MESSAGE_ADD,
    draft: { ...rule, pathPrefix: '/api', headerValue: 'different' },
    profileId: 'default'
  }, state), (error) => error.field === 'headerValue' && error.conflictId === 1);
  assert.throws(() => applyRuleIntent({ type: RULE_MESSAGE_ADD, draft: nextRules[0], profileId: 'deleted' }, state), /profile no longer exists/);
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
