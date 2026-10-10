import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from '../helpers/source.js';

const backgroundSource = readSource('extension/background.js');

test('site permission changes immediately rebuild the applied rule set', () => {
  assert.match(backgroundSource, /chrome\.permissions\.onAdded\.addListener/);
  assert.match(backgroundSource, /chrome\.permissions\.onRemoved\.addListener/);
  assert.match(backgroundSource, /refreshAfterPermissionChange/);
});

test('background state changes and reads share a serial queue', () => {
  assert.match(backgroundSource, /const enqueueBackgroundTask = createSerialQueue\(\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => handleRuleMessage\(message\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => handleActivationMessage\(message\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => initialize\(\{ newBrowserSession: true \}\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => applyExpiry\(\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => toggleMasterSwitch\(\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => refreshAfterPermissionChange\(\)\)/);
  assert.match(backgroundSource, /enqueueBackgroundTask\(\(\) => refreshTabBadge\(tabId/);
});
