import assert from 'node:assert/strict';
import test from 'node:test';
import { exportBackup, importBackup } from '../../extension/shared/runtime/backup-api.js';
import { createBackupFixture } from '../helpers/backup.js';

function setup(t, response) {
  const originalChrome = globalThis.chrome;
  const requests = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message);
        callback(response);
      }
    }
  };
  t.after(() => {
    globalThis.chrome = originalChrome;
  });
  return requests;
}

test('export sends only the export intent and returns the full backup text unchanged', async (t) => {
  const text = `${JSON.stringify(createBackupFixture(), null, 2)}\n`;
  const requests = setup(t, { ok: true, text });
  assert.equal(await exportBackup(), text);
  assert.deepEqual(requests, [{ type: 'headerkit:backup:export' }]);
});

test('import sends the selected text unchanged and returns only validated counts', async (t) => {
  const text = `\uFEFF${JSON.stringify(createBackupFixture())}`;
  const requests = setup(t, { ok: true, profileCount: 2, ruleCount: 3, extra: 'ignored' });
  assert.deepEqual(await importBackup(text), { profileCount: 2, ruleCount: 3 });
  assert.deepEqual(requests, [{ type: 'headerkit:backup:import', text }]);
});

test('profile-only imports accept zero rules', async (t) => {
  setup(t, { ok: true, profileCount: 1, ruleCount: 0 });
  assert.deepEqual(await importBackup('{}'), { profileCount: 1, ruleCount: 0 });
});

test('export rejects missing, unsuccessful, or malformed responses', async (t) => {
  const responses = [
    undefined,
    null,
    {},
    { ok: false },
    { ok: 'true', text: 'backup' },
    { ok: true },
    { ok: true, text: '' },
    { ok: true, text: 42 },
    { ok: false, error: 42 }
  ];
  for (const [index, response] of responses.entries()) {
    await t.test(`response ${index + 1}`, async (t) => {
      setup(t, response);
      await assert.rejects(exportBackup(), { message: 'Could not export a backup.' });
    });
  }
});

test('import rejects unsuccessful responses instead of assuming the backup was saved', async (t) => {
  for (const [index, response] of [
    undefined,
    null,
    {},
    { ok: false },
    { ok: 'true' },
    { ok: false, error: 42 }
  ].entries()) {
    await t.test(`response ${index + 1}`, async (t) => {
      setup(t, response);
      await assert.rejects(importBackup('{}'), { message: 'Could not import this backup.' });
    });
  }
});

test('worker error messages are propagated for export and import', async (t) => {
  setup(t, { ok: false, error: 'Storage unavailable' });
  await assert.rejects(exportBackup(), { message: 'Storage unavailable' });
  await assert.rejects(importBackup('{}'), { message: 'Storage unavailable' });
});

test('import requires safe integer counts and advises reloading on ambiguous success', async (t) => {
  const cases = [
    ['missing profile count', { ruleCount: 0 }],
    ['zero profiles', { profileCount: 0, ruleCount: 0 }],
    ['negative profiles', { profileCount: -1, ruleCount: 0 }],
    ['fractional profiles', { profileCount: 1.5, ruleCount: 0 }],
    ['text profiles', { profileCount: '1', ruleCount: 0 }],
    ['unsafe profile count', { profileCount: Number.MAX_SAFE_INTEGER + 1, ruleCount: 0 }],
    ['missing rule count', { profileCount: 1 }],
    ['negative rules', { profileCount: 1, ruleCount: -1 }],
    ['fractional rules', { profileCount: 1, ruleCount: 0.5 }],
    ['text rules', { profileCount: 1, ruleCount: '0' }],
    ['unsafe rule count', { profileCount: 1, ruleCount: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-finite rules', { profileCount: 1, ruleCount: Infinity }]
  ];
  for (const [name, counts] of cases) {
    await t.test(name, async (t) => {
      setup(t, { ok: true, ...counts });
      await assert.rejects(importBackup('{}'), {
        message: 'Could not confirm the import. Reload the rule manager before trying again.'
      });
    });
  }
});

test('Chrome transport errors reject both operations', async (t) => {
  setup(t);
  chrome.runtime.sendMessage = (_message, callback) => {
    chrome.runtime.lastError = { message: 'The worker is unavailable' };
    callback();
    delete chrome.runtime.lastError;
  };
  await assert.rejects(exportBackup(), { message: 'The worker is unavailable' });
  await assert.rejects(importBackup('{}'), { message: 'The worker is unavailable' });
});
