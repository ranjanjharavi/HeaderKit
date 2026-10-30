import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { state as optionsState } from '../../../extension/options/state.js';
import { state as popupState } from '../../../extension/popup/state.js';
import * as optionsActions from '../../../extension/options/rules/actions.js';
import * as popupActions from '../../../extension/popup/headers/actions.js';
import { renderWorkspace as renderPopupWorkspace } from '../../../extension/popup/workspace.js';
import { bindComposerEvents as bindOptionsComposer } from '../../../extension/options/rules/composer.js';
import { bindComposerEvents as bindPopupComposer } from '../../../extension/popup/headers/composer.js';
import { createUiHarness } from '../../helpers/ui-harness.js';
import { applyRuleIntent } from '../../../extension/background/rule-commit.js';
import { clearRuleFormError, showRuleFormError } from '../../../extension/shared/ui/rule-form-errors.js';

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
    currentHostname: 'api.example.com'
  });
  const calls = [];
  const messages = [];
  let storedRules = rules;
  globalThis.chrome.runtime.sendMessage = (message, callback) => {
    calls.push('commit');
    messages.push(message);
    const result = applyRuleIntent(message, {
      ...state,
      profileIds: new Set(state.profiles.map((profile) => profile.id))
    });
    storedRules = result.rules;
    callback({ ok: true, ...result });
  };
  globalThis.chrome.permissions = {
    request(_details, callback) {
      calls.push('request');
      callback(false);
    },
    getAll(callback) {
      callback({ origins: [] });
    },
    remove(_details, callback) {
      calls.push('remove');
      callback(true);
    }
  };
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });

  const actions = surface === 'options' ? optionsActions : popupActions;
  const refresh = async () => {
    state.rules = storedRules;
  };
  if (surface === 'options') {
    optionsActions.configureRuleActions({ onRender() {}, onRefresh: refresh });
    bindOptionsComposer({ onAddRule: actions.addRule });
  } else {
    popupActions.configureRuleActions({ onRefresh: refresh, onRender: renderPopupWorkspace });
    bindPopupComposer({ onAddRule: actions.addRule, onSaveRule: actions.saveEditedRule });
  }
  function draft(values, id = null) {
    const fields = {
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'enabled',
      pathPrefix: '',
      resourceType: 'all',
      profileId: 'default',
      ...values
    };
    for (const [field, value] of Object.entries(fields)) {
      const editField = field === 'profileId' ? 'Profile' : `${field[0].toUpperCase()}${field.slice(1)}`;
      const elementId = id === null ? field : `edit${editField}-${id}`;
      harness.element(elementId).value = value;
    }
  }
  return {
    ...harness,
    state,
    actions,
    calls,
    messages,
    draft,
    storeRules: (value) => {
      storedRules = value;
    }
  };
}

test('rule form errors tolerate missing forms and missing individual fields', (t) => {
  const harness = createUiHarness(t);
  document.getElementById = () => null;
  assert.doesNotThrow(() => clearRuleFormError(1));
  assert.equal(showRuleFormError({ error: 'Rejected', field: 'headerValue' }, 1), false);
  const error = harness.element('ruleEditError-1');
  document.getElementById = (id) => (id === 'ruleEditError-1' ? error : null);
  assert.equal(showRuleFormError({ error: 'Rejected', field: 'headerValue' }, 1), true);
  assert.equal(error.textContent, 'Rejected');
});

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
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    harness.state.editingId = 1;
    harness.draft({ headerValue: 'new' }, surface === 'options' ? 1 : null);
    await harness.actions.saveEditedRule(1);
    assert.deepEqual(harness.calls, ['commit']);
    assert.equal(harness.state.rules[0].headerValue, 'new');
  });

  test(`${surface} worker validation errors preserve the draft and target the rejected field`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    harness.state.editingId = 1;
    harness.draft({ headerValue: 'draft value' }, surface === 'options' ? 1 : null);
    chrome.runtime.sendMessage = (_message, callback) =>
      callback({ ok: false, error: 'Conflicts with a newer rule.', field: 'headerValue', conflictId: 2 });
    await harness.actions.saveEditedRule(1);
    const fieldId = surface === 'options' ? 'editHeaderValue-1' : 'headerValue';
    assert.equal(harness.element(fieldId).value, 'draft value');
    assert.equal(harness.element(fieldId).getAttribute('aria-invalid'), 'true');
    assert.equal(harness.state.editingId, 1);
    assert.equal(harness.state.rules[0].headerValue, 'old');
  });

  test(`${surface} worker errors fall back to status after a form disappears`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    harness.state.editingId = 1;
    harness.draft({ headerValue: 'draft value' }, surface === 'options' ? 1 : null);
    const getElement = document.getElementById.bind(document);
    chrome.runtime.sendMessage = (_message, callback) => {
      document.getElementById = (id) => (id === 'headerStatus' ? getElement(id) : null);
      callback({ ok: false, error: 'Rule changed elsewhere.', field: 'headerValue' });
    };
    await harness.actions.saveEditedRule(1);
    assert.equal(harness.element('headerStatus').textContent, 'Rule changed elsewhere.');
    assert.equal(harness.state.rules[0].headerValue, 'old');
  });

  test(`${surface} broad and wildcard grants cover resume without another request`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: false,
      profileId: 'default'
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
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: false,
      profileId: 'default'
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
    assert.deepEqual(harness.calls, ['commit', 'request', 'commit', 'commit']);
    assert.equal(harness.state.grantedOrigins.has('https://api.example.com/*'), true);
  });

  test(`${surface} deletion waits for HeaderKit confirmation and explains removal of the final grant`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    const cancelled = harness.actions.confirmDeleteRule(1);
    assert.equal(harness.element('confirmationDialog').open, true);
    assert.match(
      harness.element('confirmationMessage').textContent,
      /last rule.*site access grant will also be removed/
    );
    assert.deepEqual(harness.calls, []);
    await harness.element('confirmationCancelBtn').dispatch('click');
    await cancelled;
    assert.equal(harness.state.rules.length, 1);
    assert.deepEqual(harness.calls, []);

    const confirmed = harness.actions.confirmDeleteRule(1);
    await harness.element('confirmationConfirmBtn').dispatch('click');
    await confirmed;
    assert.equal(harness.state.rules.length, 0);
    assert.deepEqual(harness.calls, ['commit']);
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
  });

  test(`${surface} paused-rule edits save before releasing the unused old host grant`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: false,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.editingId = 1;
    harness.draft({ domain: 'qa.example.com', headerValue: 'new' }, surface === 'options' ? 1 : null);
    await harness.actions.saveEditedRule(1);
    assert.deepEqual(harness.calls, ['commit']);
    assert.equal(harness.state.rules[0].domain, 'qa.example.com');
    assert.equal(harness.state.rules[0].headerValue, 'new');
    assert.equal(harness.state.rules[0].enabled, false);
  });

  test(`${surface} denied site access reports the rule state accurately`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: false,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    await harness.actions.toggleRule(1);
    assert.deepEqual(harness.calls, ['commit', 'request']);
    assert.equal(harness.state.rules[0].enabled, true);
    assert.match(harness.element('headerStatus').textContent, /Rule resumed.*needs site access/);
  });

  test(`${surface} host edits require preflight and save before requesting new access`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.editingId = 1;
    harness.draft({ domain: 'qa.example.com', headerValue: 'new' }, surface === 'options' ? 1 : null);

    await harness.actions.saveEditedRule(1);
    const preflightId = surface === 'options' ? 'editSiteAccessPreflight-1' : 'siteAccessPreflight';
    assert.equal(harness.element(preflightId).hidden, false);
    assert.deepEqual(harness.calls, []);

    await harness.actions.saveEditedRule(1);
    assert.deepEqual(harness.calls, ['commit', 'request']);
    assert.equal(harness.state.rules[0].domain, 'qa.example.com');
    assert.equal(harness.state.rules[0].headerValue, 'new');
    assert.match(harness.element('headerStatus').textContent, /Rule saved.*needs site access/);
  });

  test(`${surface} approved-host creation normalizes scope and targets the last profile while parked`, async (t) => {
    const harness = setup(t, surface);
    harness.state.profiles.push({ id: 'qa', name: 'QA' });
    harness.state.activation = {
      ...createDefaultActivation(),
      profileId: null,
      lastProfileId: 'qa'
    };
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    harness.draft({ domain: 'HTTPS://API.EXAMPLE.COM/', pathPrefix: '/café/', resourceType: 'xmlhttprequest' });
    assert.equal(await harness.actions.addRule(), true);
    assert.deepEqual(harness.calls, ['commit']);
    assert.equal(harness.messages[0].profileId, 'qa');
    assert.equal(harness.state.rules[0].profileId, 'qa');
    assert.equal(harness.state.rules[0].pathPrefix, '/caf%C3%A9');
    assert.equal(harness.state.rules[0].resourceType, 'xmlhttprequest');
    assert.equal(harness.element('headerStatus').textContent, 'Header rule added.');
  });

  test(`${surface} editing preserves its profile policy and page-specific completion behavior`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.profiles.push({ id: 'qa', name: 'QA' });
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    harness.state.editingId = 1;
    harness.state.revealedRuleIds.add(1);
    harness.draft({ headerValue: 'updated', profileId: 'qa' }, surface === 'options' ? 1 : null);
    const result = await harness.actions.saveEditedRule(1);
    assert.equal(harness.state.rules[0].profileId, surface === 'options' ? 'qa' : 'default');
    assert.equal(harness.messages[0].profileId, surface === 'options' ? 'qa' : 'default');
    assert.equal(harness.state.rules[0].headerValue, 'updated');
    assert.equal(harness.state.revealedRuleIds.has(1), false);
    assert.equal(harness.state.editingId, surface === 'options' ? null : 1);
    assert.equal(result, surface === 'options' ? undefined : true);
    assert.equal(harness.element('headerStatus').textContent, 'Header rule updated.');
  });

  test(`${surface} conflicting resumes are rejected before saving or requesting access`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      pathPrefix: '/api',
      enabled: false,
      profileId: 'default'
    };
    const harness = setup(t, surface, [
      rule,
      { ...rule, id: 2, pathPrefix: '', enabled: true, headerValue: 'different' }
    ]);
    await harness.actions.toggleRule(1);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.state.rules[0].enabled, false);
    assert.match(harness.element('headerStatus').textContent, /Conflicts with the active X-Test rule/);
  });

  test(`${surface} a permission API error still retains a saved rule and reports missing access`, async (t) => {
    const harness = setup(t, surface);
    harness.draft({});
    assert.equal(await harness.actions.addRule(), false);
    chrome.permissions.request = (_details, callback) => {
      harness.calls.push('request');
      chrome.runtime.lastError = { message: 'Permission surface closed' };
      callback();
      delete chrome.runtime.lastError;
    };
    assert.equal(await harness.actions.addRule(), true);
    assert.deepEqual(harness.calls, ['commit', 'request']);
    assert.equal(harness.state.rules.length, 1);
    assert.match(harness.element('headerStatus').textContent, /Rule saved.*needs site access/);
  });

  test(`${surface} a rejected new-rule commit preserves its draft even if the permission prompt succeeds`, async (t) => {
    const harness = setup(t, surface);
    harness.draft({ headerValue: 'draft-secret' });
    assert.equal(await harness.actions.addRule(), false);
    chrome.runtime.sendMessage = (_message, callback) => {
      harness.calls.push('commit');
      callback({ ok: false, error: 'Newer rule conflicts.', field: 'headerValue', conflictId: 2 });
    };
    chrome.permissions.request = (_details, callback) => {
      harness.calls.push('request');
      callback(true);
    };
    assert.equal(await harness.actions.addRule(), false);
    assert.deepEqual(harness.calls, ['commit', 'request']);
    assert.deepEqual(harness.state.rules, []);
    assert.equal(harness.element('headerValue').value, 'draft-secret');
    assert.equal(harness.element('headerValue').getAttribute('aria-invalid'), 'true');
    assert.equal(harness.element('ruleComposerError').textContent, 'Newer rule conflicts.');
  });

  test(`${surface} explicit access grants reuse cached coverage and report denial without changing rules`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.grantedOrigins = new Set(['https://*.example.com/*']);
    await harness.actions.grantRuleAccess(1);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.element('headerStatus').textContent, 'Site access granted for api.example.com.');

    harness.state.grantedOrigins = new Set();
    await harness.actions.grantRuleAccess(1);
    assert.deepEqual(harness.calls, ['request']);
    assert.deepEqual(harness.state.rules, [rule]);
    assert.match(harness.element('headerStatus').textContent, /Site access.*required to resume/);
  });

  test(`${surface} delete failures retain the rule and its reveal state`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    harness.state.revealedRuleIds.add(1);
    chrome.runtime.sendMessage = (_message, callback) => {
      harness.calls.push('commit');
      callback({ ok: false, error: 'Could not save deletion.' });
    };
    const deleting = harness.actions.confirmDeleteRule(1);
    await harness.element('confirmationConfirmBtn').dispatch('click');
    await deleting;
    assert.deepEqual(harness.calls, ['commit']);
    assert.deepEqual(harness.state.rules, [rule]);
    assert.equal(harness.state.revealedRuleIds.has(1), true);
    assert.equal(harness.element('headerStatus').textContent, 'Could not save deletion.');
  });

  test(`${surface} deleting a rule shared with another profile does not promise to revoke its host grant`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule, { ...rule, id: 2, profileId: 'qa' }]);
    harness.state.grantedOrigins = new Set(['https://api.example.com/*']);
    const deleting = harness.actions.confirmDeleteRule(1);
    assert.doesNotMatch(harness.element('confirmationMessage').textContent, /grant will also be removed/);
    await harness.element('confirmationCancelBtn').dispatch('click');
    await deleting;
    assert.deepEqual(harness.calls, []);
  });

  test(`${surface} a rule removed while confirmation is open is not deleted again`, async (t) => {
    const rule = {
      id: 1,
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'old',
      enabled: true,
      profileId: 'default'
    };
    const harness = setup(t, surface, [rule]);
    const deleting = harness.actions.confirmDeleteRule(1);
    harness.state.rules = [];
    await harness.element('confirmationConfirmBtn').dispatch('click');
    await deleting;
    assert.deepEqual(harness.calls, []);
  });

  for (const action of ['create', 'edit', 'resume']) {
    test(`${surface} ${action} starts saving synchronously even if the permission prompt never responds`, async (t) => {
      const rule = {
        id: 1,
        domain: 'api.example.com',
        headerName: 'X-Test',
        headerValue: 'old',
        enabled: action === 'edit',
        profileId: 'default'
      };
      const harness = setup(t, surface, action === 'create' ? [] : [rule]);
      harness.state.editingId = action === 'edit' ? 1 : null;
      harness.draft(
        { domain: 'qa.example.com', headerValue: 'new' },
        surface === 'options' && action === 'edit' ? 1 : null
      );
      if (action === 'edit') {
        await harness.actions.saveEditedRule(1);
      } else if (action === 'create') {
        assert.equal(await harness.actions.addRule(), false);
      }
      globalThis.chrome.runtime.sendMessage = (message, callback) => {
        harness.calls.push('commit');
        const result = applyRuleIntent(message, { ...harness.state, profileIds: new Set(['default']) });
        harness.storeRules(result.rules);
        queueMicrotask(() => callback({ ok: true, ...result }));
      };
      globalThis.chrome.permissions.request = () => {
        harness.calls.push('request');
      };

      if (action === 'edit') {
        harness.actions.saveEditedRule(1);
      } else if (action === 'create') {
        harness.actions.addRule();
      } else {
        harness.actions.toggleRule(1);
      }
      assert.deepEqual(harness.calls, ['commit', 'request']);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(harness.state.rules[0].enabled, true);
      assert.equal(harness.state.rules[0].headerValue, action === 'resume' ? 'old' : 'new');
    });
  }
}
