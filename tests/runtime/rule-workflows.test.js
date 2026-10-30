import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { createRuleWorkflows } from '../../extension/shared/runtime/rule-workflows.js';

function createRule(overrides = {}) {
  return {
    id: 1,
    domain: 'api.example.com',
    headerName: 'X-Test',
    headerValue: 'one',
    pathPrefix: '',
    resourceType: 'all',
    enabled: true,
    profileId: 'default',
    ...overrides
  };
}

function createContext(overrides = {}) {
  return {
    rules: [],
    activation: createDefaultActivation(),
    grantedOrigins: new Set(),
    ...overrides
  };
}

function setup(overrides = {}) {
  const calls = [];
  const origins = new Set(['https://api.example.com/*']);
  const workflows = createRuleWorkflows({
    sendIntent: async (intent) => {
      calls.push(['commit', intent]);
    },
    refreshState: async () => {
      calls.push(['refresh']);
    },
    requestPermission: (origin) => {
      calls.push(['request', origin]);
      return Promise.resolve(true);
    },
    readOrigins: async () => {
      calls.push(['read-grants']);
      return origins;
    },
    ...overrides
  });
  return { workflows, calls, origins };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('add preparation normalizes drafts, selects the target profile, and performs no effects', () => {
  const { workflows, calls } = setup();
  const context = createContext({
    activation: { ...createDefaultActivation(), profileId: null, lastProfileId: 'qa' }
  });
  const before = structuredClone(context);
  const draft = {
    domain: 'HTTPS://API.EXAMPLE.COM/',
    headerName: ' X-New ',
    headerValue: ' value ',
    pathPrefix: '/api/'
  };
  const change = workflows.prepareAdd(draft, context);
  const rule = {
    domain: 'api.example.com',
    headerName: 'X-New',
    headerValue: 'value',
    pathPrefix: '/api',
    resourceType: 'all'
  };
  assert.deepEqual(change, {
    ok: true,
    rule: { ...rule, enabled: true, profileId: 'qa' },
    intent: { type: 'headerkit:rules:add', draft: rule, profileId: 'qa' },
    needsAccess: true
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(context, before);
  assert.equal(draft.headerName, ' X-New ');
});

test('invalid add and update drafts return field errors without saving or requesting access', () => {
  const { workflows, calls } = setup();
  const rule = createRule();
  const context = createContext({ rules: [rule] });
  assert.deepEqual(workflows.prepareAdd({ ...rule, headerName: '' }, context), {
    ok: false,
    field: 'headerName',
    error: 'Enter a header name.'
  });
  const duplicate = workflows.prepareAdd(rule, context);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.field, 'headerName');
  const invalidEdit = workflows.prepareUpdate(rule, { ...rule, headerValue: '' }, context);
  assert.equal(invalidEdit.ok, false);
  assert.equal(invalidEdit.field, 'headerValue');
  assert.deepEqual(calls, []);
});

test('update preparation preserves paused state and its profile unless a page explicitly reassigns it', () => {
  const { workflows } = setup();
  const rule = createRule({ enabled: false, profileId: 'qa' });
  const draft = { ...rule, domain: 'other.example.com', profileId: 'default' };
  const context = createContext({ rules: [rule] });
  const before = structuredClone({ rule, draft, context });
  const unchangedProfile = workflows.prepareUpdate(rule, draft, context);
  assert.equal(unchangedProfile.ok, true);
  assert.equal(unchangedProfile.rule.profileId, 'qa');
  assert.equal(unchangedProfile.rule.enabled, false);
  assert.equal(unchangedProfile.needsAccess, false);
  assert.equal(unchangedProfile.intent.type, 'headerkit:rules:update');
  assert.equal(unchangedProfile.intent.id, rule.id);
  assert.equal(unchangedProfile.intent.profileId, 'qa');
  const reassigned = workflows.prepareUpdate(rule, draft, context, 'default');
  assert.equal(reassigned.rule.profileId, 'default');
  assert.equal(reassigned.intent.profileId, 'default');
  assert.deepEqual({ rule, draft, context }, before);
});

test('resume preparation checks live conflicts but pausing never requests access', () => {
  const { workflows, calls } = setup();
  const paused = createRule({ enabled: false, pathPrefix: '/api' });
  const active = createRule({ id: 2, headerValue: 'different' });
  const conflict = workflows.prepareToggle(paused, createContext({ rules: [paused, active] }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflictId, 2);
  assert.match(conflict.error, /Conflicts with the active X-Test rule/);
  assert.deepEqual(calls, []);
  const resume = workflows.prepareToggle(paused, createContext({ rules: [paused] }));
  assert.equal(resume.rule.enabled, true);
  assert.equal(resume.needsAccess, true);
  assert.deepEqual(resume.intent, { type: 'headerkit:rules:set-enabled', id: 1, enabled: true });
  const pause = workflows.prepareToggle(active, createContext({ rules: [active] }));
  assert.equal(pause.rule.enabled, false);
  assert.equal(pause.needsAccess, false);
  assert.equal(paused.enabled, false);
  assert.equal(active.enabled, true);
});

test('cached broad and wildcard grants satisfy save plans without another permission request', async () => {
  for (const origin of ['https://api.example.com/*', 'https://*/*', 'https://*.example.com/*']) {
    const { workflows, calls } = setup();
    const rule = createRule({ enabled: false });
    const change = workflows.prepareToggle(rule, createContext({ rules: [rule], grantedOrigins: new Set([origin]) }));
    assert.equal(change.needsAccess, false);
    assert.deepEqual(await workflows.save(change), { permission: null });
    assert.deepEqual(calls, [['commit', change.intent], ['refresh']]);
  }
});

test('save waits for the worker commit before refreshing the page snapshot', async () => {
  const committed = deferred();
  const refreshed = deferred();
  const calls = [];
  const { workflows } = setup({
    sendIntent: () => {
      calls.push('commit');
      return committed.promise;
    },
    refreshState: () => {
      calls.push('refresh');
      return refreshed.promise;
    }
  });
  const change = workflows.prepareAdd(
    createRule(),
    createContext({ grantedOrigins: new Set(['https://api.example.com/*']) })
  );
  let finished = false;
  const saving = workflows.save(change).then((result) => {
    finished = true;
    return result;
  });
  assert.deepEqual(calls, ['commit']);
  committed.resolve();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['commit', 'refresh']);
  assert.equal(finished, false);
  refreshed.resolve();
  assert.deepEqual(await saving, { permission: null });
});

test('save starts the durable commit and permission request synchronously, even with a pending prompt', async () => {
  const committed = deferred();
  const permission = deferred();
  const calls = [];
  const origins = new Set(['https://api.example.com/*']);
  const { workflows } = setup({
    sendIntent: () => {
      calls.push('commit');
      return committed.promise;
    },
    refreshState: async () => {
      calls.push('refresh');
    },
    requestPermission: (origin) => {
      calls.push(['request', origin]);
      return permission.promise;
    },
    readOrigins: async () => {
      calls.push('read-grants');
      return origins;
    }
  });
  const change = workflows.prepareAdd(createRule(), createContext());
  const saving = workflows.save(change);
  try {
    assert.deepEqual(calls, ['commit', ['request', 'https://api.example.com/*']]);
    committed.resolve();
    await new Promise(setImmediate);
    assert.deepEqual(calls, ['commit', ['request', 'https://api.example.com/*'], 'refresh']);
  } finally {
    committed.resolve();
    permission.resolve(true);
  }
  assert.deepEqual(await saving, { permission: { granted: true, permissionError: null }, grantedOrigins: origins });
  assert.equal(calls.at(-1), 'read-grants');
});

for (const outcome of ['denied', 'rejected']) {
  test(`a ${outcome} permission request preserves the committed rule and refreshes known grants`, async () => {
    const error = new Error('Permission surface closed');
    const { workflows, calls, origins } = setup({
      requestPermission: () => {
        if (outcome === 'rejected') throw error;
        return false;
      }
    });
    const change = workflows.prepareAdd(createRule(), createContext());
    assert.deepEqual(await workflows.save(change), {
      permission: { granted: false, permissionError: outcome === 'rejected' ? error : null },
      grantedOrigins: origins
    });
    assert.deepEqual(calls, [['commit', change.intent], ['refresh'], ['read-grants']]);
  });
}

for (const failure of ['commit', 'refresh']) {
  test(`a ${failure} failure is propagated with its validation metadata even when permissions also fail`, async () => {
    const error = Object.assign(new Error('Rule changed elsewhere'), { field: 'headerValue', conflictId: 2 });
    const permissionError = new Error('Permission closed');
    const calls = [];
    const { workflows } = setup({
      sendIntent: () => {
        calls.push('commit');
        if (failure === 'commit') throw error;
      },
      refreshState: () => {
        calls.push('refresh');
        throw error;
      },
      requestPermission: () => {
        calls.push('request');
        throw permissionError;
      },
      readOrigins: () => {
        assert.fail('Failed saves must not publish a new grant snapshot.');
      }
    });
    const change = workflows.prepareAdd(createRule(), createContext());
    const saving = workflows.save(change);
    assert.deepEqual(calls, ['commit', 'request']);
    await assert.rejects(saving, (received) => received === error);
    assert.deepEqual(calls, failure === 'commit' ? ['commit', 'request'] : ['commit', 'request', 'refresh']);
  });
}

test('an unavailable grant snapshot is returned as unknown, without mutating the supplied context', async () => {
  const { workflows } = setup({ readOrigins: async () => null });
  const context = createContext();
  const before = structuredClone(context);
  const change = workflows.prepareAdd(createRule(), context);
  const result = await workflows.save(change);
  assert.equal(result.permission.granted, true);
  assert.equal(result.grantedOrigins, null);
  assert.deepEqual(context, before);
});

test('deletion impact considers all profiles and only promises removal of an explicit final-host grant', () => {
  const { workflows, calls } = setup();
  const rule = createRule();
  const context = createContext({ rules: [rule], grantedOrigins: new Set(['https://api.example.com/*']) });
  assert.equal(workflows.willReleaseHostAccess(rule, context), true);
  assert.equal(
    workflows.willReleaseHostAccess(rule, { ...context, rules: [rule, createRule({ id: 2, profileId: 'qa' })] }),
    false
  );
  assert.equal(
    workflows.willReleaseHostAccess(rule, {
      ...context,
      rules: [rule, createRule({ id: 2, domain: 'other.example.com' })]
    }),
    true
  );
  for (const grantedOrigins of [null, new Set(), new Set(['https://*/*']), new Set(['https://*.example.com/*'])]) {
    assert.equal(workflows.willReleaseHostAccess(rule, { ...context, grantedOrigins }), false);
  }
  assert.deepEqual(calls, []);
});

test('deletion persists an intent and refreshes without requesting or revoking permissions from the page', async () => {
  const { workflows, calls } = setup();
  await workflows.remove(7);
  assert.deepEqual(calls, [['commit', { type: 'headerkit:rules:delete', id: 7 }], ['refresh']]);
});

test('explicit grants delegate to the shared permission adapter with the cached snapshot', async () => {
  const rule = createRule();
  const cached = new Set();
  const updated = new Set(['https://api.example.com/*']);
  const { workflows, calls } = setup({
    ensurePermission: (receivedRule, receivedOrigins) => {
      assert.equal(receivedRule, rule);
      assert.equal(receivedOrigins, cached);
      return Promise.resolve(updated);
    }
  });
  assert.equal(await workflows.grantAccess(rule, cached), updated);
  assert.deepEqual(calls, []);
});

test('workflow instances keep their commit and refresh dependencies independent', async () => {
  const first = setup();
  const second = setup();
  const change = first.workflows.prepareAdd(createRule(), createContext({ grantedOrigins: first.origins }));
  await first.workflows.save(change);
  assert.deepEqual(first.calls, [['commit', change.intent], ['refresh']]);
  assert.deepEqual(second.calls, []);
  await second.workflows.remove(9);
  assert.deepEqual(second.calls, [['commit', { type: 'headerkit:rules:delete', id: 9 }], ['refresh']]);
  assert.equal(first.calls.length, 2);
});
