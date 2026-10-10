import assert from 'node:assert/strict';
import test from 'node:test';

import { saveRuleBeforePermissionPrompt } from '../../extension/shared/runtime/site-access-save.js';

const rule = {
  id: 1,
  domain: 'example.com',
  headerName: 'X-Test',
  headerValue: 'value',
  enabled: true,
  profileId: 'default'
};

test('durable rule save starts before the Chrome permission request', async () => {
  const calls = [];
  const resultPromise = saveRuleBeforePermissionPrompt(rule, [rule], {
    persistRules(rules) {
      calls.push(['persist', rules]);
      return Promise.resolve();
    },
    requestPermission(origin) {
      calls.push(['permission', origin]);
      return Promise.resolve(true);
    }
  });

  assert.deepEqual(calls, [
    ['persist', [rule]],
    ['permission', 'https://example.com/*']
  ]);
  assert.deepEqual(await resultPromise, { granted: true, permissionError: null });
});

test('a rejected permission prompt does not discard the durable rule save', async () => {
  let persisted = false;
  const permissionError = new Error('Permission surface closed');
  const result = await saveRuleBeforePermissionPrompt(rule, [rule], {
    persistRules() {
      persisted = true;
    },
    requestPermission() {
      throw permissionError;
    }
  });

  assert.equal(persisted, true);
  assert.equal(result.granted, false);
  assert.equal(result.permissionError, permissionError);
});

test('a failed durable save is still reported as an error', async () => {
  const storageError = new Error('Storage failed');

  await assert.rejects(saveRuleBeforePermissionPrompt(rule, [rule], {
    persistRules() {
      throw storageError;
    },
    requestPermission() {
      return true;
    }
  }), storageError);
});
