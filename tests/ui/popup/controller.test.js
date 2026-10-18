import assert from 'node:assert/strict';
import test from 'node:test';
import { bindHeaderEvents, initializeHeaders } from '../../../extension/popup/headers/controller.js';
import { state } from '../../../extension/popup/state.js';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

test('popup startup extracts HTTPS hosts without throwing on credentials or malformed tab URLs', async (t) => {
  const harness = createUiHarness(t);
  chrome.permissions = {
    getAll: (callback) => callback({ origins: [] }),
    onAdded: { addListener() {} },
    onRemoved: { addListener() {} }
  };
  chrome.storage = { onChanged: { addListener() {} } };
  chrome.runtime.sendMessage = (_message, callback) => callback({
    ok: true,
    rules: [],
    profiles: [{ id: 'default', name: 'Default' }],
    activation: createDefaultActivation()
  });
  bindHeaderEvents();
  for (const [url, hostname] of [
    ['https://user:pass@example.com/', 'example.com'],
    ['https://API.Example.com:8443/path', 'api.example.com'],
    ['https://[broken', ''],
    ['chrome://extensions/', ''],
    ['http://localhost:3000/', ''],
    ['', '']
  ]) {
    await initializeHeaders({ url });
    assert.equal(state.headers.currentHostname, hostname);
    assert.equal(harness.element('domain').value, hostname);
    assert.equal(harness.element('currentSiteTab').disabled, !hostname);
  }
});