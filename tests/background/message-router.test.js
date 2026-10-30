import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import { createMessageRouter } from '../../extension/background/message-router.js';
import { createSerialQueue } from '../../extension/shared/runtime/serial-queue.js';

const trusted = { id: 'unit', url: 'chrome-extension://unit/popup/index.html' };

function setup(overrides = {}) {
  const calls = [];
  const queued = [];
  const errors = [];
  const queue = createSerialQueue();
  const values = {
    handleBackupExport: 'serialized backup',
    handleBackupImport: { profileCount: 1, ruleCount: 2 },
    handleRuleMessage: { rules: [{ id: 1 }], rule: { id: 1 } },
    handleActivationMessage: { masterEnabled: false },
    handleStateMessage: {
      rules: [{ id: 1 }],
      profiles: [{ id: 'default' }],
      activation: {},
      profile: { id: 'created' },
      grantedOrigins: new Set(['https://example.com/*']),
      profileIds: new Set(['default'])
    }
  };
  const handlers = Object.fromEntries(
    Object.entries(values).map(([name, result]) => [
      name,
      async (message) => {
        calls.push([name, message]);
        return result;
      }
    ])
  );
  const router = createMessageRouter({
    extensionId: overrides.extensionId ?? 'unit',
    extensionRoot: overrides.extensionRoot ?? 'chrome-extension://unit/',
    handlers: { ...handlers, ...overrides.handlers },
    enqueue:
      overrides.enqueue ??
      ((task) => {
        queued.push(task);
        return queue(task);
      }),
    onError: (...args) => errors.push(args)
  });
  async function dispatch(message, sender = trusted) {
    let respond;
    const response = new Promise((resolve) => {
      respond = resolve;
    });
    const accepted = router(message, sender, respond);
    return accepted ? { accepted, response: await response } : { accepted };
  }
  return { router, dispatch, values, calls, queued, errors };
}

const groups = [
  { types: ['headerkit:backup:export'], handler: 'handleBackupExport', fallback: 'Could not export a backup.' },
  { types: ['headerkit:backup:import'], handler: 'handleBackupImport', fallback: 'Could not process the backup.' },
  {
    types: ['headerkit:rules:add', 'headerkit:rules:update', 'headerkit:rules:set-enabled', 'headerkit:rules:delete'],
    handler: 'handleRuleMessage',
    fallback: 'Could not update header rules.'
  },
  {
    types: ['headerkit:activation:set-master', 'headerkit:activation:set-profile', 'headerkit:activation:set-duration'],
    handler: 'handleActivationMessage',
    fallback: 'Could not update the HeaderKit switch.'
  },
  {
    types: [
      'headerkit:profiles:create',
      'headerkit:profiles:rename',
      'headerkit:profiles:duplicate',
      'headerkit:profiles:delete',
      'headerkit:state:get'
    ],
    handler: 'handleStateMessage',
    fallback: 'Could not update profiles.'
  }
];

test('every supported message is queued and dispatched with the existing response shape', async (t) => {
  for (const { types, handler } of groups) {
    for (const type of types) {
      await t.test(type, async () => {
        const harness = setup();
        const message = { type, id: 7, text: 'backup payload' };
        const result = await harness.dispatch(message);
        assert.equal(result.accepted, true);
        assert.equal(harness.queued.length, 1);
        assert.deepEqual(harness.calls, [[handler, message]]);
        const value = harness.values[handler];
        const expected =
          handler === 'handleBackupExport'
            ? { ok: true, text: value }
            : handler === 'handleActivationMessage'
              ? { ok: true, activation: value }
              : handler === 'handleStateMessage'
                ? {
                    ok: true,
                    rules: value.rules,
                    profiles: value.profiles,
                    activation: value.activation,
                    profile: value.profile
                  }
                : { ok: true, ...value };
        assert.deepEqual(result.response, expected);
        assert.equal('grantedOrigins' in result.response, false);
        assert.equal('profileIds' in result.response, false);
      });
    }
  }
});

test('untrusted senders and unknown requests are rejected synchronously without queueing or responding', () => {
  const harness = setup();
  const replies = [];
  for (const sender of [
    undefined,
    null,
    {},
    { id: 'unit' },
    { id: 'other', url: trusted.url },
    { id: 'unit', url: 42 },
    { id: 'unit', url: { startsWith: () => true } },
    { id: 'unit', url: 'https://example.com/' },
    { id: 'unit', url: 'chrome-extension://unit.example/popup/index.html' },
    { id: 'unit', url: 'chrome-extension://unit' }
  ]) {
    assert.equal(
      harness.router({ type: 'headerkit:state:get' }, sender, (value) => replies.push(value)),
      false
    );
  }
  for (const message of [undefined, null, {}, 42, { type: '__proto__' }, { type: 'headerkit:rules:commit' }]) {
    assert.equal(
      harness.router(message, trusted, (value) => replies.push(value)),
      false
    );
  }
  assert.deepEqual(harness.queued, []);
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(replies, []);
});

test('accepted listeners return literal true before async work settles and respond exactly once', async () => {
  let finish;
  const task = new Promise((resolve) => {
    finish = resolve;
  });
  const harness = setup({ handlers: { handleBackupExport: () => task } });
  const replies = [];
  let replied;
  const response = new Promise((resolve) => {
    replied = resolve;
  });
  const accepted = harness.router({ type: 'headerkit:backup:export' }, trusted, (value) => {
    replies.push(value);
    replied();
  });
  assert.equal(accepted, true);
  assert.deepEqual(replies, []);
  finish('finished');
  await response;
  assert.deepEqual(replies, [{ ok: true, text: 'finished' }]);
});

test('handler failures preserve worker messages and rule-validation metadata, including fallback messages', async (t) => {
  for (const { types, handler, fallback } of groups) {
    for (const message of ['Worker rejected the operation', '']) {
      await t.test(`${handler}: ${message || 'fallback'}`, async () => {
        const error = Object.assign(new Error(message), { field: 'headerValue', conflictId: 9 });
        const harness = setup({
          handlers: {
            [handler]: () => {
              throw error;
            }
          }
        });
        const result = await harness.dispatch({ type: types[0] });
        const expected = { ok: false, error: message || fallback };
        if (handler === 'handleRuleMessage') Object.assign(expected, { field: 'headerValue', conflictId: 9 });
        assert.deepEqual(result.response, expected);
        assert.equal(harness.errors.length, 1);
      });
    }
  }
});

test('backup error logging never receives backup text, imported values, or error payloads', async () => {
  for (const handler of ['handleBackupExport', 'handleBackupImport']) {
    const error = Object.assign(new Error('Cannot process backup'), { payload: { headerValue: 'synthetic-secret' } });
    const harness = setup({
      handlers: {
        [handler]: () => {
          throw error;
        }
      }
    });
    await harness.dispatch({
      type: handler === 'handleBackupExport' ? 'headerkit:backup:export' : 'headerkit:backup:import',
      text: 'synthetic-secret'
    });
    assert.equal(harness.errors[0].length, 1);
    assert.doesNotMatch(inspect(harness.errors, { depth: null }), /synthetic-secret|payload|headerValue/);
  }
});

test('failed requests do not poison the shared queue or delay later successful responses', async () => {
  let first = true;
  const harness = setup({
    handlers: {
      handleBackupExport: async () => {
        if (first) {
          first = false;
          throw new Error('First failed');
        }
        return 'second succeeded';
      }
    }
  });
  const [failed, succeeded] = await Promise.all([
    harness.dispatch({ type: 'headerkit:backup:export' }),
    harness.dispatch({ type: 'headerkit:backup:export' })
  ]);
  assert.deepEqual(failed.response, { ok: false, error: 'First failed' });
  assert.deepEqual(succeeded.response, { ok: true, text: 'second succeeded' });
});

test('router instances keep their own trust boundaries and handlers', async () => {
  const first = setup();
  const second = setup({ extensionId: 'other', extensionRoot: 'chrome-extension://other/' });
  assert.deepEqual(await second.dispatch({ type: 'headerkit:state:get' }), { accepted: false });
  assert.equal((await first.dispatch({ type: 'headerkit:state:get' })).accepted, true);
  assert.deepEqual(second.calls, []);
  const otherSender = { id: 'other', url: 'chrome-extension://other/options/index.html' };
  assert.equal((await second.dispatch({ type: 'headerkit:state:get' }, otherSender)).accepted, true);
  assert.equal(first.calls.length, 1);
});
