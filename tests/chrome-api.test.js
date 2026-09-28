import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTab,
  getCurrentTab,
  removeOriginPermission,
  requestOriginPermission,
  sendRuntimeMessage,
  storageAreaRemove,
  storageLocalGet,
  storageLocalSet
} from '../extension/shared/runtime/chrome-api.js';

function createChromeApi() {
  return {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({ ok: true, echo: message });
      }
    },
    storage: {
      local: {
        get(query, callback) {
          callback({ query });
        },
        set(value, callback) {
          this.value = value;
          callback();
        },
        remove(keys, callback) {
          this.removed = keys;
          callback();
        }
      }
    },
    permissions: {
      request(details, callback) {
        this.requested = details;
        callback(true);
      },
      remove(details, callback) {
        this.removed = details;
        callback(true);
      }
    },
    tabs: {
      query(query, callback) {
        callback([{ id: 7, url: 'https://example.com' }]);
      },
      create(details, callback) {
        this.created = details;
        callback({ id: 8, ...details });
      }
    }
  };
}

test('Chrome API wrappers resolve callback results', async () => {
  const chromeApi = createChromeApi();

  assert.deepEqual(await storageLocalGet(['key'], chromeApi), { query: ['key'] });
  await storageLocalSet({ privacyConsentVersion: 1 }, chromeApi);
  assert.deepEqual(chromeApi.storage.local.value, { privacyConsentVersion: 1 });
  await storageAreaRemove(chromeApi.storage.local, ['obsolete'], chromeApi);
  assert.deepEqual(chromeApi.storage.local.removed, ['obsolete']);
  assert.equal(await requestOriginPermission('https://example.com/*', chromeApi), true);
  assert.deepEqual(chromeApi.permissions.requested, { origins: ['https://example.com/*'] });
  assert.equal(await removeOriginPermission('https://example.com/*', chromeApi), true);
  assert.deepEqual(chromeApi.permissions.removed, { origins: ['https://example.com/*'] });
  assert.deepEqual(await getCurrentTab(chromeApi), { id: 7, url: 'https://example.com' });
  assert.deepEqual(await createTab({ url: 'https://example.com', active: true }, chromeApi), {
    id: 8,
    url: 'https://example.com',
    active: true
  });
  assert.deepEqual(await sendRuntimeMessage({ type: 'test' }, chromeApi), {
    ok: true,
    echo: { type: 'test' }
  });
});

test('Chrome API wrappers reject runtime.lastError', async () => {
  const chromeApi = createChromeApi();
  chromeApi.storage.local.get = (query, callback) => {
    chromeApi.runtime.lastError = { message: 'Storage unavailable' };
    callback({});
    chromeApi.runtime.lastError = null;
  };

  await assert.rejects(storageLocalGet(['key'], chromeApi), /Storage unavailable/);
});
