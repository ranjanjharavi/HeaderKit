import assert from 'node:assert/strict';
import test from 'node:test';
import { installBackgroundHarness } from '../helpers/background-harness.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { CURRENT_SCHEMA_VERSION } from '../../extension/background/migrate.js';
import { EXPIRY_ALARM } from '../../extension/background/controller.js';

test('site permission changes immediately rebuild the applied rule set', async (t) => {
  const harness = await worker(t);
  const origins = [];
  chrome.permissions.getAll = (callback) => callback({ origins: [...origins] });
  const added = await harness.send({
    type: 'headerkit:rules:add',
    profileId: 'default',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' }
  });
  assert.equal(added.ok, true);
  assert.deepEqual(harness.getDynamicRules(), []);
  const savedRules = structuredClone(harness.storage.headerRules);

  origins.push('https://example.com/*');
  chrome.permissions.onAdded.emit({ origins: [...origins] });
  await harness.send({ type: 'headerkit:state:get' });
  assert.deepEqual(
    harness.getDynamicRules().map((rule) => rule.id),
    [added.rule.id]
  );

  origins.length = 0;
  chrome.permissions.onRemoved.emit({ origins: ['https://example.com/*'] });
  await harness.send({ type: 'headerkit:state:get' });
  assert.deepEqual(harness.getDynamicRules(), []);
  assert.deepEqual(harness.storage.headerRules, savedRules);
});

test('background state changes and reads wait for an in-flight commit in enqueue order', async (t) => {
  const harness = await worker(t);
  const set = chrome.storage.local.set.bind(chrome.storage.local);
  let releaseWrite;
  let markWriteStarted;
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve;
  });
  chrome.storage.local.set = (values, callback) => {
    chrome.storage.local.set = set;
    releaseWrite = () => set(values, callback);
    markWriteStarted();
  };
  const adding = harness.send({
    type: 'headerkit:rules:add',
    profileId: 'default',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' }
  });
  await writeStarted;
  let snapshotResolved = false;
  const snapshot = harness.send({ type: 'headerkit:state:get' }).then((result) => {
    snapshotResolved = true;
    return result;
  });
  const pausing = harness.send({ type: 'headerkit:activation:set-master', enabled: false });
  try {
    await new Promise(setImmediate);
    assert.equal(snapshotResolved, false);
    assert.deepEqual(harness.storage.headerRules, []);
    assert.equal(harness.storage.activation.masterEnabled, true);
    assert.deepEqual(harness.writes, []);
  } finally {
    releaseWrite();
  }

  const [added, read, paused] = await Promise.all([adding, snapshot, pausing]);
  assert.equal(added.ok, true);
  assert.equal(read.ok, true);
  assert.deepEqual(read.rules, added.rules);
  assert.equal(read.activation.masterEnabled, true);
  assert.equal(paused.ok, true);
  assert.equal(paused.activation.masterEnabled, false);
  assert.equal(harness.storage.activation.masterEnabled, false);
  assert.deepEqual(harness.getDynamicRules(), []);
});

test('worker composition registers its listeners without eagerly reading storage', async (t) => {
  const harness = await worker(t);
  assert.deepEqual(harness.reads, []);
  for (const event of [
    chrome.storage.onChanged,
    chrome.runtime.onMessage,
    chrome.runtime.onInstalled,
    chrome.runtime.onStartup,
    chrome.permissions.onAdded,
    chrome.permissions.onRemoved,
    chrome.alarms.onAlarm,
    chrome.commands.onCommand,
    chrome.tabs.onUpdated,
    chrome.tabs.onRemoved
  ]) {
    assert.equal(event.listenerCount, 1);
  }
  assert.equal(chrome.tabs.onActivated.listenerCount, 0);
  chrome.commands.onCommand.emit('unrelated-command');
  chrome.alarms.onAlarm.emit({ name: 'unrelated-alarm' });
  await new Promise(setImmediate);
  assert.deepEqual(harness.reads, []);
});

test('installation migrates saved data before rebuilding applied rules', async (t) => {
  const harness = await worker(t, {
    headerRules: [
      { id: 1, domain: 'example.com', headerName: 'X-Test', headerValue: 'one', enabled: true, profileId: 'default' }
    ]
  });
  chrome.runtime.onInstalled.emit();
  const state = await harness.send({ type: 'headerkit:state:get' });
  assert.equal(state.ok, true);
  assert.equal(harness.storage.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(
    harness.getDynamicRules().map((rule) => rule.id),
    [1]
  );
  assert.equal(state.rules[0].enabled, true);
});

test('keyboard commands wait behind an in-flight activation commit on the shared queue', async (t) => {
  const harness = await worker(t);
  await harness.send({
    type: 'headerkit:rules:add',
    profileId: 'default',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' }
  });
  const set = chrome.storage.local.set.bind(chrome.storage.local);
  let releaseWrite;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  chrome.storage.local.set = (values, callback) => {
    chrome.storage.local.set = set;
    releaseWrite = () => set(values, callback);
    markStarted();
  };
  const pausing = harness.send({ type: 'headerkit:activation:set-master', enabled: false });
  await started;
  chrome.commands.onCommand.emit('toggle-master');
  const reading = harness.send({ type: 'headerkit:state:get' });
  try {
    await new Promise(setImmediate);
    assert.equal(harness.storage.activation.masterEnabled, true);
  } finally {
    releaseWrite();
  }
  assert.equal((await pausing).activation.masterEnabled, false);
  assert.equal((await reading).activation.masterEnabled, true);
  assert.equal(harness.storage.activation.masterEnabled, true);
  assert.equal(harness.getDynamicRules().length, 1);
});

test('an expiry alarm parks activation, clears applied rules, and leaves saved rule flags untouched', async (t) => {
  let now = 10_000;
  t.mock.method(Date, 'now', () => now);
  const harness = await worker(t, {
    activation: { ...createDefaultActivation(), expiresAt: 20_000, durationMs: 10_000 },
    headerRules: [
      { id: 1, domain: 'example.com', headerName: 'X-Test', headerValue: 'one', enabled: true, profileId: 'default' }
    ]
  });
  await harness.send({ type: 'headerkit:activation:set-master', enabled: true });
  assert.equal(harness.getDynamicRules().length, 1);
  const alarms = t.mock.method(chrome.alarms, 'clear');
  now = 21_000;
  chrome.alarms.onAlarm.emit({ name: EXPIRY_ALARM });
  const expired = await harness.send({ type: 'headerkit:state:get' });
  assert.equal(expired.activation.profileId, null);
  assert.equal(harness.storage.activation.expiresAt, null);
  assert.equal(harness.storage.headerRules[0].enabled, true);
  assert.deepEqual(harness.getDynamicRules(), []);
  assert.equal(alarms.mock.calls.at(-1).arguments[0], EXPIRY_ALARM);
});

test('permission cleanup failures do not turn a durable deletion into a failed request', async (t) => {
  const harness = await worker(t);
  const added = await harness.send({
    type: 'headerkit:rules:add',
    profileId: 'default',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' }
  });
  chrome.permissions.remove = (_details, callback) => {
    chrome.runtime.lastError = { message: 'Cannot release grant' };
    callback();
    chrome.runtime.lastError = null;
  };
  const removed = await harness.send({ type: 'headerkit:rules:delete', id: added.rule.id });
  assert.equal(removed.ok, true);
  assert.deepEqual(harness.storage.headerRules, []);
  assert.deepEqual(harness.getDynamicRules(), []);
});

test('alarm scheduling failures retain the committed activation and keep the queue usable', async (t) => {
  const harness = await worker(t);
  chrome.alarms.clear = (_name, callback) => {
    chrome.runtime.lastError = { message: 'Alarms unavailable' };
    callback();
    chrome.runtime.lastError = null;
  };
  const selected = await harness.send({ type: 'headerkit:activation:set-duration', durationMs: 60_000 });
  assert.equal(selected.ok, true);
  assert.ok(harness.storage.activation.expiresAt > Date.now());
  assert.equal(
    (await harness.send({ type: 'headerkit:state:get' })).activation.expiresAt,
    selected.activation.expiresAt
  );
});

async function worker(t, stored = {}) {
  const originalChrome = globalThis.chrome;
  const originalError = console.error;
  console.error = () => {};
  const storage = {
    profiles: [
      { id: 'default', name: 'Default' },
      { id: 'staging', name: 'Staging' }
    ],
    headerRules: [],
    activation: createDefaultActivation(),
    ...stored
  };
  const origins = ['https://example.com/*', 'https://staging.example.com/*'];
  const removed = [];
  const reads = [];
  let failWrite = false;
  const chromeApi = {
    runtime: { lastError: null },
    storage: {
      local: {
        get: (keys, callback) => {
          reads.push([...keys]);
          callback(structuredClone(Object.fromEntries(keys.map((key) => [key, storage[key]]))));
        },
        set: (value, callback) => {
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
      getAll: (callback) => callback({ origins }),
      remove: ({ origins: released }, callback) => {
        removed.push(...released);
        callback(true);
      }
    }
  };
  const harness = await installBackgroundHarness(chromeApi);
  t.after(async () => {
    await new Promise((resolve) => chromeApi.runtime.sendMessage({ type: 'headerkit:state:get' }, resolve));
    globalThis.chrome = originalChrome;
    console.error = originalError;
  });
  return {
    ...harness,
    storage,
    removed,
    reads,
    failNextWrite: () => {
      failWrite = true;
    },
    send: (message) => new Promise((resolve) => chromeApi.runtime.sendMessage(message, resolve))
  };
}

test('stalled badge queries do not block commits and navigation bursts avoid broad queries', async (context) => {
  const harness = await worker(context);
  let releaseQuery;
  let markQueryStarted;
  let queries = 0;
  const queryStarted = new Promise((resolve) => {
    markQueryStarted = resolve;
  });
  const texts = [];
  chrome.action.setBadgeText = async (details) => {
    texts.push(details);
  };
  chrome.tabs.query = (_query, callback) => {
    queries++;
    const tabs = [{ id: 7, url: 'https://example.com/' }];
    if (queries === 1) {
      releaseQuery = () => callback(tabs);
      markQueryStarted();
      return;
    }
    callback(tabs);
  };
  const draft = { domain: 'example.com', headerName: 'X-One', headerValue: 'one' };
  assert.equal((await harness.send({ type: 'headerkit:rules:add', draft, profileId: 'default' })).ok, true);
  await queryStarted;
  const second = await harness.send({
    type: 'headerkit:rules:add',
    draft: { ...draft, headerName: 'X-Two' },
    profileId: 'default'
  });
  assert.equal(second.ok, true);
  releaseQuery();
  await new Promise(setImmediate);
  const before = queries;
  texts.length = 0;
  chrome.tabs.onUpdated.emit(7, { status: 'complete' }, { id: 7, url: 'https://example.com/' });
  chrome.tabs.onActivated.emit({ tabId: 7 });
  await new Promise(setImmediate);
  assert.deepEqual(texts, []);
  for (let index = 0; index < 100; index++) {
    chrome.tabs.onUpdated.emit(7, { url: `https://unrelated.example.net/${index}` }, { id: 7 });
  }
  await new Promise(setImmediate);
  assert.equal(queries, before);
  assert.deepEqual(texts, [{ tabId: 7, text: '' }]);
});

test('worker cache avoids repeated reads and tracks committed writes and external changes', async (context) => {
  const harness = await worker(context);
  let reads = 0;
  let grantReads = 0;
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  const getAll = chrome.permissions.getAll.bind(chrome.permissions);
  chrome.storage.local.get = (keys, callback) => {
    reads++;
    get(keys, callback);
  };
  chrome.permissions.getAll = (callback) => {
    grantReads++;
    getAll(callback);
  };
  await harness.send({ type: 'headerkit:state:get' });
  await harness.send({ type: 'headerkit:state:get' });
  assert.equal(reads, 1);
  assert.equal(grantReads, 1);
  const created = await harness.send({ type: 'headerkit:profiles:create', name: 'Cached' });
  const added = await harness.send({
    type: 'headerkit:rules:add',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' },
    profileId: created.profile.id
  });
  assert.equal(added.ok, true);
  const reorderedRules = harness.storage.headerRules.map((rule) => Object.fromEntries(Object.entries(rule).reverse()));
  chrome.storage.onChanged.emit({ headerRules: { newValue: reorderedRules } }, 'local');
  await harness.send({ type: 'headerkit:state:get' });
  assert.equal(reads, 1);
  assert.equal(grantReads, 1);
  harness.failNextWrite();
  const failed = await harness.send({
    type: 'headerkit:rules:update',
    id: added.rule.id,
    draft: { ...added.rule, headerValue: 'failed' },
    profileId: created.profile.id
  });
  assert.equal(failed.ok, false);
  assert.equal((await harness.send({ type: 'headerkit:state:get' })).rules[0].headerValue, 'one');
  assert.equal(reads, 1);
  chrome.storage.onChanged.emit({ activation: { newValue: {} } }, 'sync');
  await harness.send({ type: 'headerkit:state:get' });
  assert.equal(reads, 1);
  harness.storage.headerRules[0].headerValue = 'external';
  chrome.storage.onChanged.emit({ headerRules: { newValue: harness.storage.headerRules } }, 'local');
  assert.equal((await harness.send({ type: 'headerkit:state:get' })).rules[0].headerValue, 'external');
  assert.equal(reads, 2);
  chrome.permissions.onRemoved.emit({ origins: ['https://example.com/*'] });
  await harness.send({ type: 'headerkit:state:get' });
  assert.equal(reads, 3);
  assert.equal(grantReads, 3);
});

test('worker cache retries failed permission reads instead of retaining unavailable grants', async (context) => {
  const harness = await worker(context);
  let reads = 0;
  const getAll = chrome.permissions.getAll.bind(chrome.permissions);
  chrome.permissions.getAll = (callback) => {
    reads++;
    if (reads === 1) {
      chrome.runtime.lastError = { message: 'Unavailable' };
      callback({});
      chrome.runtime.lastError = null;
      return;
    }
    getAll(callback);
  };
  await harness.send({ type: 'headerkit:state:get' });
  await harness.send({ type: 'headerkit:state:get' });
  await harness.send({ type: 'headerkit:state:get' });
  assert.equal(reads, 2);
});

test('a storage change during a cold read cannot publish a stale cache', async (context) => {
  const harness = await worker(context);
  let releaseRead;
  let markReadStarted;
  const readStarted = new Promise((resolve) => {
    markReadStarted = resolve;
  });
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  let firstRead = true;
  chrome.storage.local.get = (keys, callback) =>
    get(keys, (value) => {
      if (firstRead) {
        firstRead = false;
        releaseRead = () => callback(value);
        markReadStarted();
        return;
      }
      callback(value);
    });
  const pending = harness.send({ type: 'headerkit:state:get' });
  await readStarted;
  harness.storage.activation.masterEnabled = false;
  chrome.storage.onChanged.emit({ activation: { newValue: harness.storage.activation } }, 'local');
  releaseRead();
  assert.equal((await pending).activation.masterEnabled, false);
  assert.equal((await harness.send({ type: 'headerkit:state:get' })).activation.masterEnabled, false);
});

test('cached state rechecks timer expiry against the current clock', async (context) => {
  let now = 10_000;
  context.mock.method(Date, 'now', () => now);
  const harness = await worker(context, {
    activation: { ...createDefaultActivation(), expiresAt: 20_000, durationMs: 10_000 }
  });
  assert.equal((await harness.send({ type: 'headerkit:state:get' })).activation.profileId, 'default');
  now = 21_000;
  const expired = await harness.send({ type: 'headerkit:state:get' });
  assert.equal(expired.activation.profileId, null);
  assert.equal(harness.storage.activation.expiresAt, null);
  assert.equal((await harness.send({ type: 'headerkit:state:get' })).activation.profileId, null);
});

test('actual worker rejects untrusted senders before reading or mutating state', async (context) => {
  const harness = await worker(context);
  const id = chrome.runtime.id;
  const url = chrome.runtime.getURL('popup/index.html');
  let reads = 0;
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (keys, callback) => {
    reads++;
    get(keys, callback);
  };
  const before = structuredClone(harness.storage);
  const senders = [
    undefined,
    null,
    {},
    { id },
    { url },
    { id: 'another-extension', url },
    { id, url: 'https://example.com/' },
    { id, url: `https://example.com/${url}` },
    { id, url: `chrome-extension://${id}.example/popup/index.html` },
    { id, url: `chrome-extension://${id}` },
    { id, url: 42 },
    { id, url: { startsWith: () => true } }
  ];
  const messages = [
    { type: 'headerkit:state:get' },
    { type: 'headerkit:rules:add', draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' } },
    { type: 'headerkit:activation:set-master', enabled: false },
    { type: 'headerkit:profiles:create', name: 'Untrusted' }
  ];
  for (const sender of senders) {
    for (const message of messages) {
      assert.equal(await harness.sendFrom(message, sender), undefined);
    }
  }
  assert.equal(reads, 0);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.storage, before);
  assert.deepEqual(harness.getDynamicRules(), []);
  assert.deepEqual(harness.getSessionRules(), []);
  for (const page of ['popup/index.html', 'options/index.html']) {
    const result = await harness.sendFrom({ type: 'headerkit:state:get' }, { id, url: chrome.runtime.getURL(page) });
    assert.equal(result.ok, true);
  }
});

test('actual worker merges concurrent rule intents and rejects conflicts and stale references', async (t) => {
  const harness = await worker(t);
  const draft = { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' };
  const results = await Promise.all([
    harness.send({ type: 'headerkit:rules:add', id: 42, draft, profileId: 'default' }),
    harness.send({ type: 'headerkit:rules:add', draft: { ...draft, headerName: 'X-Other' }, profileId: 'default' })
  ]);
  assert.ok(results.every((result) => result.ok));
  assert.deepEqual(
    results.map((result) => result.rule.id),
    [1, 2]
  );
  const conflict = await harness.send({
    type: 'headerkit:rules:add',
    draft: { ...draft, pathPrefix: '/api', headerValue: 'different' },
    profileId: 'default'
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.field, 'headerValue');
  assert.equal(conflict.conflictId, 1);
  const duplicate = await harness.send({ type: 'headerkit:rules:add', draft, profileId: 'default' });
  assert.equal(duplicate.field, 'headerName');
  await Promise.all([
    harness.send({ type: 'headerkit:rules:set-enabled', id: 1, enabled: false }),
    harness.send({
      type: 'headerkit:rules:update',
      id: 2,
      draft: { ...draft, headerName: 'X-Other', headerValue: 'updated' },
      profileId: 'default'
    }),
    harness.send({ type: 'headerkit:rules:delete', id: 1 })
  ]);
  assert.equal(harness.storage.headerRules.length, 1);
  assert.equal(harness.storage.headerRules[0].headerValue, 'updated');
  const stale = await harness.send({ type: 'headerkit:rules:update', id: 1, draft, profileId: 'default' });
  assert.equal(stale.ok, false);
  const missingProfile = await harness.send({ type: 'headerkit:rules:add', draft, profileId: 'deleted' });
  assert.match(missingProfile.error, /profile no longer exists/);
  const before = structuredClone(harness.storage);
  assert.equal(await harness.send({ type: 'headerkit:rules:commit', rules: [] }), undefined);
  assert.equal(await harness.send({ type: 'headerkit:activation:set', activation: {} }), undefined);
  assert.deepEqual(harness.storage, before);
});

test('actual worker profile transactions roll back storage failures and clean up final-host grants', async (t) => {
  const harness = await worker(t, {
    headerRules: [
      {
        id: 1,
        domain: 'staging.example.com',
        headerName: 'X-Test',
        headerValue: 'one',
        enabled: true,
        profileId: 'staging'
      }
    ],
    activation: { ...createDefaultActivation(), profileId: 'staging', lastProfileId: 'staging' }
  });
  await harness.send({ type: 'headerkit:activation:set-master', enabled: true });
  const before = structuredClone(harness.storage);
  const dynamicBefore = harness.getDynamicRules();
  for (const type of ['headerkit:profiles:duplicate', 'headerkit:profiles:delete']) {
    harness.failNextWrite();
    const result = await harness.send({ type, id: 'staging', name: 'Copy' });
    assert.equal(result.ok, false);
    assert.deepEqual(harness.storage, before);
    assert.deepEqual(harness.getDynamicRules(), dynamicBefore);
    assert.deepEqual(harness.removed, []);
  }
  const copied = await harness.send({ type: 'headerkit:profiles:duplicate', id: 'staging', name: 'Copy' });
  assert.equal(copied.ok, true);
  assert.equal(copied.rules[1].enabled, false);
  assert.deepEqual(Object.keys(harness.writes.at(-1)).sort(), ['activation', 'headerRules', 'profiles']);
  await harness.send({ type: 'headerkit:profiles:delete', id: copied.profile.id });
  assert.deepEqual(harness.removed, []);
  const [deleted, stale] = await Promise.all([
    harness.send({ type: 'headerkit:profiles:delete', id: 'staging' }),
    harness.send({
      type: 'headerkit:rules:add',
      draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'old' },
      profileId: 'staging'
    })
  ]);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.activation.profileId, 'default');
  assert.equal(deleted.rules.length, 0);
  assert.deepEqual(harness.removed, ['https://staging.example.com/*']);
  assert.equal(stale.ok, false);
  assert.equal(harness.storage.headerRules.length, 0);
});

test('actual worker resolves expired snapshots and applies activation intents to current master state', async (t) => {
  const harness = await worker(t, { activation: { ...createDefaultActivation(), expiresAt: 1, durationMs: 60_000 } });
  const snapshot = await harness.send({ type: 'headerkit:state:get' });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.activation.profileId, null);
  assert.equal(snapshot.activation.expiresAt, null);
  await harness.send({ type: 'headerkit:activation:set-master', enabled: false });
  const selected = await harness.send({ type: 'headerkit:activation:set-profile', profileId: 'staging' });
  assert.equal(selected.activation.masterEnabled, false);
  assert.equal(selected.activation.profileId, 'staging');
  const before = structuredClone(harness.storage);
  harness.failNextWrite();
  const failed = await harness.send({ type: 'headerkit:activation:set-master', enabled: true });
  assert.equal(failed.ok, false);
  assert.deepEqual(harness.storage, before);
});

test('until-browser-close activation uses only session rules and Chrome clears them before startup', async (t) => {
  const harness = await worker(t);
  await harness.send({
    type: 'headerkit:rules:add',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' },
    profileId: 'default'
  });
  assert.equal(harness.getDynamicRules().length, 1);
  await harness.send({ type: 'headerkit:activation:set-duration', untilBrowserClose: true });
  assert.equal(harness.getDynamicRules().length, 0);
  assert.equal(harness.getSessionRules().length, 1);
  harness.clearSessionRules();
  assert.equal(harness.getDynamicRules().length + harness.getSessionRules().length, 0);
  chrome.runtime.onStartup.emit();
  const snapshot = await harness.send({ type: 'headerkit:state:get' });
  assert.equal(snapshot.activation.profileId, null);
  assert.equal(snapshot.rules.length, 1);
  assert.equal(harness.getSessionRules().length, 0);
});

test('switching between session and dynamic rules restores the prior set on API or storage failure', async (t) => {
  const harness = await worker(t);
  await harness.send({
    type: 'headerkit:rules:add',
    draft: { domain: 'example.com', headerName: 'X-Test', headerValue: 'one' },
    profileId: 'default'
  });
  const dynamicBefore = harness.getDynamicRules();
  for (const failure of ['api', 'storage']) {
    if (failure === 'api') {
      harness.failNextRuleUpdate('session');
    } else {
      harness.failNextWrite();
    }
    const result = await harness.send({ type: 'headerkit:activation:set-duration', untilBrowserClose: true });
    assert.equal(result.ok, false);
    assert.equal(harness.storage.activation.untilBrowserClose, false);
    assert.deepEqual(harness.getDynamicRules(), dynamicBefore);
    assert.deepEqual(harness.getSessionRules(), []);
  }
  await harness.send({ type: 'headerkit:activation:set-duration', untilBrowserClose: true });
  const sessionBefore = harness.getSessionRules();
  harness.failNextRuleUpdate('dynamic');
  const rejected = await harness.send({ type: 'headerkit:activation:set-duration', durationMs: 60_000 });
  assert.equal(rejected.ok, false);
  assert.deepEqual(harness.getSessionRules(), sessionBefore);
  assert.deepEqual(harness.getDynamicRules(), []);
  const timed = await harness.send({ type: 'headerkit:activation:set-duration', durationMs: 60_000 });
  assert.equal(timed.ok, true);
  assert.equal(harness.getDynamicRules().length, 1);
  assert.equal(harness.getSessionRules().length, 0);
  const expiry = timed.activation.expiresAt;
  chrome.runtime.onStartup.emit();
  const snapshot = await harness.send({ type: 'headerkit:state:get' });
  assert.equal(snapshot.activation.expiresAt, expiry);
  assert.equal(snapshot.activation.profileId, 'default');
});

test('regex quota is checked before changing either applied ruleset', async (t) => {
  const harness = await worker(t);
  chrome.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES = 1;
  await harness.send({
    type: 'headerkit:rules:add',
    draft: { domain: 'example.com', headerName: 'X-One', headerValue: 'one' },
    profileId: 'default'
  });
  await harness.send({ type: 'headerkit:activation:set-duration', untilBrowserClose: true });
  const before = harness.getSessionRules();
  const rejected = await harness.send({
    type: 'headerkit:rules:add',
    draft: { domain: 'example.com', headerName: 'X-Two', headerValue: 'two' },
    profileId: 'default'
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /at most 1 active header rules/);
  assert.deepEqual(harness.getSessionRules(), before);
  assert.deepEqual(harness.getDynamicRules(), []);
  assert.equal(harness.storage.headerRules.length, 1);
});
