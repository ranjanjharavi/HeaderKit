import assert from 'node:assert/strict';
import test from 'node:test';
import { requirePrivacyConsent } from '../../../extension/shared/ui/privacy.js';
import { createUiHarness } from '../../helpers/ui-harness.js';
import { readSource } from '../../helpers/source.js';

function setup(t, version) {
  const harness = createUiHarness(t);
  const stored = {
    headerRules: [{ id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'value' }],
    profiles: [{ id: 'default', name: 'Default' }],
    activation: { masterEnabled: false, profileId: 'default' }
  };
  if (version !== undefined) {
    stored.privacyConsentVersion = version;
  }
  const writes = [];
  chrome.storage = {
    local: {
      get(query, callback) {
        callback({ ...query, ...stored });
      },
      set(value, callback) {
        writes.push(value);
        Object.assign(stored, value);
        callback();
      }
    }
  };
  return { ...harness, stored, writes };
}

for (const version of [undefined, 0, 1]) {
  test(`consent version ${version ?? 'missing'} requires acceptance of the updated notice`, async (t) => {
    const harness = setup(t, version);
    const originalData = structuredClone(harness.stored);
    const pending = requirePrivacyConsent();
    await Promise.resolve();

    assert.equal(harness.element('privacyGate').hidden, false);
    assert.equal(harness.element('appShell').hidden, true);
    assert.deepEqual(harness.writes, []);

    await harness.element('privacyConsentBtn').dispatch('click');
    await pending;

    assert.deepEqual(harness.writes, [{ privacyConsentVersion: 2 }]);
    assert.deepEqual(harness.stored, { ...originalData, privacyConsentVersion: 2 });
    assert.equal(harness.element('privacyGate').hidden, true);
    assert.equal(harness.element('appShell').hidden, false);
  });
}

for (const version of [2, 3]) {
  test(`consent version ${version} opens the app without another write`, async (t) => {
    const harness = setup(t, version);
    await requirePrivacyConsent();

    assert.equal(harness.element('privacyGate').hidden, true);
    assert.equal(harness.element('appShell').hidden, false);
    assert.deepEqual(harness.writes, []);
  });
}

test('a failed consent write keeps the app gated and can be retried', async (t) => {
  const harness = setup(t, 1);
  t.mock.method(console, 'error', () => {});
  const save = chrome.storage.local.set;
  chrome.storage.local.set = (_value, callback) => {
    chrome.runtime.lastError = { message: 'Storage unavailable' };
    callback();
    delete chrome.runtime.lastError;
  };
  const pending = requirePrivacyConsent();
  await Promise.resolve();

  await harness.element('privacyConsentBtn').dispatch('click');
  assert.equal(harness.element('privacyGate').hidden, false);
  assert.equal(harness.element('appShell').hidden, true);
  assert.equal(harness.element('privacyConsentBtn').disabled, false);
  assert.match(harness.element('privacyConsentStatus').textContent, /could not save your choice/);
  assert.equal(harness.stored.privacyConsentVersion, 1);

  chrome.storage.local.set = save;
  await harness.element('privacyConsentBtn').dispatch('click');
  await pending;
  assert.equal(harness.stored.privacyConsentVersion, 2);
  assert.equal(harness.element('appShell').hidden, false);
});

test('both privacy gates disclose background URL reads and unencrypted storage', () => {
  for (const surface of ['popup', 'options']) {
    const markup = readSource(`extension/${surface}/index.html`);
    const notice = markup.match(/<section id="privacyGate"[\s\S]*?<\/section>/)[0];
    assert.match(notice, /background on sites you grant access to/);
    assert.match(notice, /URLs are not stored or sent to the developer/);
    assert.match(notice, /stored unencrypted/);
    assert.match(notice, /Existing rules and site access are unchanged/);
  }
});

test('generated policy pages retain the source date and material disclosures', () => {
  const policy = readSource('privacy/policy.md');
  const date = policy.match(/^Last updated: (.+)$/m)[1];
  for (const source of [policy, readSource('extension/privacy/index.html'), readSource('docs/privacy-policy.html')]) {
    assert.ok(source.includes(`Last updated: ${date}`));
    assert.match(source, /Toolbar badge URLs/);
    assert.match(source, /URLs are not stored or sent to the developer/);
    assert.match(source, /unencrypted local storage/);
    assert.match(source, /popup and rule manager/);
    assert.match(source, /Header values are visible while you edit/);
    assert.match(source, /edit its last rule to use another host/);
    assert.match(source, /Alt\+Shift\+X/);
    assert.doesNotMatch(source, /only after you open ReqKit|These protections do not prevent/);
  }
});