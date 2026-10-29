import { STATE_MESSAGE_GET } from '../../extension/shared/runtime/messages.js';

// Illustrative artwork data only. Never request real site access or save rules.
const profiles = [
  { id: 'default', name: 'Staging', createdAt: 0, defaultDurationMs: null },
  { id: 'qa', name: 'QA', createdAt: 1, defaultDurationMs: null },
  { id: 'development', name: 'Development', createdAt: 2, defaultDurationMs: null }
];
const rules = [
  { id: 1, profileId: 'default', domain: 'api.example.com', headerName: 'X-Environment', headerValue: 'staging', pathPrefix: '/api/v1', resourceType: 'xmlhttprequest', enabled: true },
  { id: 2, profileId: 'default', domain: 'api.example.com', headerName: 'X-Debug-Mode', headerValue: 'enabled', pathPrefix: '', resourceType: 'all', enabled: true },
  { id: 3, profileId: 'default', domain: 'api.example.com', headerName: 'X-Trace', headerValue: 'verbose', pathPrefix: '', resourceType: 'all', enabled: false },
  { id: 4, profileId: 'qa', domain: 'qa.example.com', headerName: 'X-Environment', headerValue: 'qa', pathPrefix: '', resourceType: 'all', enabled: true },
  { id: 5, profileId: 'qa', domain: 'qa.example.com', headerName: 'X-Debug-Mode', headerValue: 'enabled', pathPrefix: '', resourceType: 'all', enabled: false },
  { id: 6, profileId: 'development', domain: 'dev.example.com', headerName: 'X-Environment', headerValue: 'development', pathPrefix: '', resourceType: 'all', enabled: true }
];
const activation = {
  masterEnabled: true,
  profileId: 'default',
  lastProfileId: 'default',
  expiresAt: Date.now() + 3600000,
  durationMs: 3600000,
  untilBrowserClose: false
};
const origins = ['https://api.example.com/*', 'https://qa.example.com/*', 'https://dev.example.com/*'];
const event = { addListener() {} };

window.chrome = {
  storage: {
    local: {
      get(query, callback) {
        callback({ privacyConsentVersion: 2 });
      },
      set(values, callback) {
        callback();
      }
    },
    onChanged: event
  },
  permissions: {
    getAll(callback) {
      callback({ origins: [...origins] });
    },
    request(options, callback) {
      callback(false);
    },
    remove(options, callback) {
      callback(false);
    },
    onAdded: event,
    onRemoved: event
  },
  tabs: {
    query(options, callback) {
      callback([{ id: 1, url: 'https://api.example.com/api/v1/users' }]);
    }
  },
  runtime: {
    getURL(path) {
      return new URL('/extension/' + path, location.origin).href;
    },
    openOptionsPage(callback) {
      window.open('/extension/options/index.html', '_blank', 'noopener');
      callback();
    },
    sendMessage(message, callback) {
      if (message.type === STATE_MESSAGE_GET) {
        callback({ ok: true, ...structuredClone({ profiles, rules, activation }) });
        return;
      }
      callback({ ok: false, error: 'Read-only preview. Load the unpacked extension to change rules or settings.' });
    }
  }
};
