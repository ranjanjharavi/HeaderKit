import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { state as optionsState } from '../../../extension/options/state.js';
import { state as popupState } from '../../../extension/popup/state.js';
import * as optionsActions from '../../../extension/options/rules/actions.js';
import * as popupActions from '../../../extension/popup/headers/actions.js';
import { bindComposerEvents as bindOptionsComposer } from '../../../extension/options/rules/composer.js';
import { bindComposerEvents as bindPopupComposer } from '../../../extension/popup/headers/composer.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

function setup(t, surface, rules = []) {
  const harness = createUiHarness(t);
  const state = surface === 'options' ? optionsState : popupState.headers;
  Object.assign(state, {
    rules,
    profiles: [{ id: 'default', name: 'Default' }],
    activation: createDefaultActivation(),
    grantedOrigins: new Set(),
    editingId: null,
    composerOpen: false,
    collapsedDomains: new Set(),
    revealedRuleIds: new Set(),
    searchQuery: '',
    scope: 'site',
    currentHostname: 'api.example.com',
    syncPaused: false
  });
  const calls = [];
  globalThis.chrome.runtime.sendMessage = (message, callback) => {
    calls.push('commit');
    callback({ ok: true, rules: message.rules });
  };
  globalThis.chrome.permissions = {
    request(_details, callback) { calls.push('request'); callback(false); },
    getAll(callback) { callback({ origins: [] }); },
    remove(_details, callback) { calls.push('remove'); callback(true); }
  };
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });

  const actions = surface === 'options' ? optionsActions : popupActions;
  if (surface === 'options') {
    optionsActions.configureRuleActions({ onRender() {} });
    bindOptionsComposer({ onAddRule: actions.addRule });
  } else {
    bindPopupComposer({ onAddRule: actions.addRule, onSaveRule: actions.saveEditedRule });
  }
  function draft(values, id = null) {
    const fields = {
      domain: 'api.example.com', headerName: 'X-Test', headerValue: 'enabled',
      pathPrefix: '', resourceType: 'all', profileId: 'default', ...values
    };
    for (const [field, value] of Object.entries(fields)) {
      const elementId = id === null ? field : `edit${field[0].toUpperCase()}${field.slice(1)}-${id}`;
      harness.element(elementId).value = value;
    }
  }
  return { ...harness, state, actions, calls, draft };
}

for (const surface of ['options', 'popup']) {
  test(`${surface} invalid drafts stay in the form without saving or requesting access`, async (t) => {
    const harness = setup(t, surface);
    harness.draft({ headerName: '' });
    assert.equal(await harness.actions.addRule(), false);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.element('ruleComposerError').hidden, false);
    assert.equal(harness.element('ruleComposerError').textContent, 'Enter a header name.');
    assert.equal(harness.element('headerName').getAttribute('aria-invalid'), 'true');
    assert.equal(document.activeElement, harness.element('headerName'));
    assert.equal(harness.element('headerValue').value, 'enabled');

    await harness.element('headerComposerForm').dispatch('input');
    assert.equal(harness.element('ruleComposerError').hidden, true);
    assert.equal(harness.element('headerName').getAttribute('aria-invalid'), undefined);
  });

  test(`${surface} editing an approved host commits without requesting access`, async (t) => {
    const rule = {
      id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'old',
      enabled: true, profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    harness.state.editingId = 1;
    harness.draft({ headerValue: 'new' }, surface === 'options' ? 1 : null);
    await harness.actions.saveEditedRule(1);
    assert.deepEqual(harness.calls, ['commit']);
    assert.equal(harness.state.rules[0].headerValue, 'new');
  });

  test(`${surface} broad and wildcard grants cover resume without another request`, async (t) => {
    const rule = {
      id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'old',
      enabled: false, profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    for (const origin of ['https://*/*', 'https://*.example.com/*']) {
      harness.state.rules = [rule];
      harness.state.grantedOrigins = new Set([origin]);
      await harness.actions.toggleRule(1);
      assert.equal(harness.state.rules[0].enabled, true);
    }
    assert.deepEqual(harness.calls, ['commit', 'commit']);
  });

  test(`${surface} newly granted access is reused when the rule is paused and resumed`, async (t) => {
    const rule = {
      id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'old',
      enabled: false, profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    globalThis.chrome.permissions.request = (_details, callback) => {
      harness.calls.push('request');
      callback(true);
    };
    globalThis.chrome.permissions.getAll = (callback) => callback({ origins: ['https://api.example.com/*'] });
    await harness.actions.toggleRule(1);
    await harness.actions.toggleRule(1);
    await harness.actions.toggleRule(1);
    assert.deepEqual(harness.calls, ['request', 'commit', 'commit', 'commit']);
    assert.equal(harness.state.grantedOrigins.has('https://api.example.com/*'), true);
  });

  test(`${surface} deletion waits for ReqKit confirmation and explains removal of the final grant`, async (t) => {
    const rule = {
      id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'old',
      enabled: true, profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    const cancelled = harness.actions.confirmDeleteRule(1);
    assert.equal(harness.element('confirmationDialog').open, true);
    assert.match(harness.element('confirmationMessage').textContent, /last rule.*site access grant will also be removed/);
    assert.deepEqual(harness.calls, []);
    await harness.element('confirmationCancelBtn').dispatch('click');
    await cancelled;
    assert.equal(harness.state.rules.length, 1);
    assert.deepEqual(harness.calls, []);

    const confirmed = harness.actions.confirmDeleteRule(1);
    await harness.element('confirmationConfirmBtn').dispatch('click');
    await confirmed;
    assert.equal(harness.state.rules.length, 0);
    assert.deepEqual(harness.calls, ['commit', 'remove']);
  });

  test(`${surface} creation requires preflight and retains a saved rule when access is denied`, async (t) => {
    const harness = setup(t, surface);
    harness.draft({});
    assert.equal(await harness.actions.addRule(), false);
    assert.equal(harness.element('siteAccessPreflight').hidden, false);
    assert.deepEqual(harness.calls, []);

    assert.equal(await harness.actions.addRule(), true);
    assert.deepEqual(harness.calls, ['commit', 'request']);
    assert.equal(harness.state.rules.length, 1);
    assert.equal(harness.state.rules[0].domain, 'api.example.com');
    assert.match(harness.element('headerStatus').textContent, /Rule saved.*needs site access/);
    assert.equal(harness.state.syncPaused, false);
  });

  test(`${surface} paused-rule edits save before releasing the unused old host grant`, async (t) => {
    const rule = {
      id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'old',
      enabled: false, profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.editingId = 1;
    harness.draft({ domain: 'qa.example.com', headerValue: 'new' }, surface === 'options' ? 1 : null);
    await harness.actions.saveEditedRule(1);
    assert.deepEqual(harness.calls, ['commit', 'remove']);
    assert.equal(harness.state.rules[0].domain, 'qa.example.com');
    assert.equal(harness.state.rules[0].headerValue, 'new');
    assert.equal(harness.state.rules[0].enabled, false);
  });

  test(`${surface} denied site access leaves a resumed rule paused and uncommitted`, async (t) => {
    const rule = {
      id: 1, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'old',
      enabled: false, profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    await harness.actions.toggleRule(1);
    assert.deepEqual(harness.calls, ['request']);
    assert.equal(harness.state.rules[0].enabled, false);
    assert.match(harness.element('headerStatus').textContent, /required to resume/);
  });
}
