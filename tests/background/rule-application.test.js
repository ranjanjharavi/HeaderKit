import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuleApplication } from '../../extension/background/rule-application.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { buildDynamicRule } from '../../extension/shared/domain/rules.js';

function rule(id = 1, overrides = {}) {
  return {
    id,
    domain: 'example.com',
    headerName: `X-Test-${id}`,
    headerValue: 'one',
    enabled: true,
    profileId: 'default',
    ...overrides
  };
}

function setup({ dynamic = [], session = [], failUpdate, failRead } = {}) {
  const rulesets = { dynamic: structuredClone(dynamic), session: structuredClone(session) };
  const calls = [];
  const errors = [];
  let limit = 1000;
  const read = async (kind) => {
    calls.push(['read', kind]);
    const error = failRead?.(kind);
    if (error) throw error;
    return structuredClone(rulesets[kind]);
  };
  const update = async (kind, details) => {
    calls.push(['update', kind, structuredClone(details)]);
    const error = failUpdate?.(kind, details);
    if (error) throw error;
    rulesets[kind] = [
      ...rulesets[kind].filter((rule) => !details.removeRuleIds.includes(rule.id)),
      ...structuredClone(details.addRules)
    ];
  };
  const apply = createRuleApplication({
    getDynamicRules: () => read('dynamic'),
    getSessionRules: () => read('session'),
    updateDynamicRules: (details) => update('dynamic', details),
    updateSessionRules: (details) => update('session', details),
    getRegexRuleLimit: () => limit,
    onError: (...args) => errors.push(args)
  });
  return {
    apply,
    rulesets,
    calls,
    errors,
    setLimit: (value) => {
      limit = value;
    }
  };
}

for (const mode of ['dynamic', 'session']) {
  const inactive = mode === 'dynamic' ? 'session' : 'dynamic';
  const activation = { ...createDefaultActivation(), untilBrowserClose: mode === 'session' };

  test(`${mode} application removes the other ruleset before replacing its own and filters non-applicable rules`, async () => {
    const harness = setup({ dynamic: [{ id: 90 }], session: [{ id: 91 }] });
    const rules = [
      rule(),
      rule(2, { enabled: false }),
      rule(3, { profileId: 'qa' }),
      rule(4, { domain: 'ungranted.example.com' })
    ];
    const before = structuredClone(rules);
    await harness.apply(rules, activation, new Set(['https://example.com/*']));
    assert.deepEqual(harness.rulesets[mode], [buildDynamicRule(rules[0])]);
    assert.deepEqual(harness.rulesets[inactive], []);
    assert.deepEqual(
      harness.calls.filter(([operation]) => operation === 'update').map(([, kind]) => kind),
      [inactive, mode]
    );
    assert.deepEqual(rules, before);
  });

  test(`${mode} application checks the current quota before changing either ruleset`, async () => {
    const harness = setup({ dynamic: [{ id: 90 }], session: [{ id: 91 }] });
    const before = structuredClone(harness.rulesets);
    harness.setLimit(0);
    await assert.rejects(harness.apply([rule()], activation, null), /at most 0 active header rules/);
    assert.deepEqual(harness.rulesets, before);
    assert.deepEqual(harness.calls, [
      ['read', 'dynamic'],
      ['read', 'session']
    ]);
    harness.setLimit(1);
    await harness.apply([rule()], activation, null);
    assert.equal(harness.rulesets[mode].length, 1);
  });

  test(`${mode} application restores the previous inactive ruleset when the destination update fails`, async () => {
    const failure = new Error('Destination update failed');
    let fail = true;
    const harness = setup({
      dynamic: [{ id: 90 }],
      session: [{ id: 91 }],
      failUpdate: (kind) => {
        if (kind === mode && fail) {
          fail = false;
          return failure;
        }
      }
    });
    const before = structuredClone(harness.rulesets);
    await assert.rejects(harness.apply([rule()], activation, null), (error) => error === failure);
    assert.deepEqual(harness.rulesets, before);
    assert.deepEqual(harness.errors, []);
    const updates = harness.calls.filter(([operation]) => operation === 'update');
    assert.deepEqual(
      updates.map(([, kind]) => kind),
      [inactive, mode, inactive]
    );
    assert.deepEqual(updates.at(-1)[2], { removeRuleIds: [], addRules: before[inactive] });
    await harness.apply([rule()], activation, null);
    assert.deepEqual(harness.rulesets[mode], [buildDynamicRule(rule())]);
    assert.deepEqual(harness.rulesets[inactive], []);
  });

  test(`${mode} application stops if clearing the inactive ruleset fails`, async () => {
    const failure = new Error('Cannot clear inactive rules');
    const harness = setup({
      dynamic: [{ id: 90 }],
      session: [{ id: 91 }],
      failUpdate: (kind) => (kind === inactive ? failure : null)
    });
    const before = structuredClone(harness.rulesets);
    await assert.rejects(harness.apply([rule()], activation, null), (error) => error === failure);
    assert.deepEqual(harness.rulesets, before);
    assert.deepEqual(
      harness.calls.filter(([operation]) => operation === 'update').map(([, kind]) => kind),
      [inactive]
    );
  });

  test(`${mode} application reports a rollback failure without replacing the original error`, async () => {
    const failure = new Error('Destination update failed');
    const rollbackFailure = new Error('Rollback failed');
    const harness = setup({
      dynamic: [{ id: 90 }],
      session: [{ id: 91 }],
      failUpdate: (kind, details) => (kind === mode ? failure : details.addRules.length ? rollbackFailure : null)
    });
    await assert.rejects(harness.apply([rule()], activation, null), (error) => error === failure);
    assert.deepEqual(harness.errors, [['Could not restore the previous applied rules.', rollbackFailure]]);
    assert.deepEqual(harness.rulesets[inactive], []);
  });
}

test('a missing grant snapshot keeps existing fallback semantics while an empty known grant list applies no rules', async () => {
  const harness = setup();
  await harness.apply([rule()], createDefaultActivation(), new Set());
  assert.deepEqual(harness.rulesets.dynamic, []);
  await harness.apply([rule()], createDefaultActivation(), null);
  assert.deepEqual(harness.rulesets.dynamic, [buildDynamicRule(rule())]);
  await harness.apply([rule()], { ...createDefaultActivation(), masterEnabled: false }, null);
  assert.deepEqual(harness.rulesets.dynamic, []);
});

test('read failures leave both rulesets unchanged and never attempt an update', async () => {
  const failure = new Error('Rules unavailable');
  for (const mode of ['dynamic', 'session']) {
    const harness = setup({
      dynamic: [{ id: 90 }],
      session: [{ id: 91 }],
      failRead: (kind) => (kind === mode ? failure : null)
    });
    const before = structuredClone(harness.rulesets);
    await assert.rejects(harness.apply([rule()], createDefaultActivation(), null), (error) => error === failure);
    assert.deepEqual(harness.rulesets, before);
    assert.equal(harness.calls.filter(([operation]) => operation === 'update').length, 0);
  }
});

test('a failed update with no inactive rules needs no rollback and instances remain independent', async () => {
  const failure = new Error('Update failed');
  const first = setup({ failUpdate: () => failure });
  const second = setup();
  await assert.rejects(first.apply([rule()], createDefaultActivation(), null), (error) => error === failure);
  assert.deepEqual(
    first.calls.filter(([operation]) => operation === 'update').map(([, kind]) => kind),
    ['dynamic']
  );
  assert.deepEqual(second.calls, []);
  await second.apply([rule()], createDefaultActivation(), null);
  assert.deepEqual(first.rulesets.dynamic, []);
  assert.deepEqual(second.rulesets.dynamic, [buildDynamicRule(rule())]);
});
