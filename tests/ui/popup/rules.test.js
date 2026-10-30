import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindHeaderEvents,
  initializeHeaders,
  refreshFromStorage
} from '../../../extension/popup/headers/controller.js';
import { renderRules, renderCurrentSiteControls } from '../../../extension/popup/headers/view.js';
import { getPopupRuleViewModel } from '../../../extension/popup/view-model.js';
import { createPopupWorkspace } from '../../../extension/popup/workspace.js';
import { state } from '../../../extension/popup/state.js';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { createBackupFixture } from '../../helpers/backup.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

async function setup(t) {
  const harness = createUiHarness(t);
  const fixture = createBackupFixture();
  fixture.rules.push({
    ...fixture.rules[0],
    id: 10,
    domain: 'other.example.com',
    headerName: 'X-Other',
    headerValue: 'ordinary',
    enabled: false
  });
  const snapshot = { rules: fixture.rules, profiles: fixture.profiles, activation: createDefaultActivation() };
  Object.assign(state.headers, {
    ...snapshot,
    grantedOrigins: null,
    currentHostname: '',
    scope: 'site',
    editingId: null,
    composerOpen: false,
    collapsedDomains: new Set(),
    revealedRuleIds: new Set()
  });
  const tabs = ['site', 'all'].map((scope) => {
    const tab = harness.element(scope === 'site' ? 'currentSiteTab' : 'allRulesTab');
    tab.dataset.ruleScope = scope;
    return tab;
  });
  const queryTabs = (selector) => (selector.includes(':not(:disabled)') ? tabs.filter((tab) => !tab.disabled) : tabs);
  document.querySelectorAll = queryTabs;
  harness.element('ruleScopeTabs').querySelectorAll = queryTabs;
  chrome.permissions = {
    getAll: (callback) => callback({ origins: ['https://api.example.com/*'] }),
    onAdded: { addListener() {} },
    onRemoved: { addListener() {} }
  };
  chrome.storage = { onChanged: { addListener() {} } };
  const messages = [];
  chrome.runtime.sendMessage = (message, callback) => {
    messages.push(message);
    callback({ ok: true, ...snapshot });
  };
  bindHeaderEvents();
  await initializeHeaders({ url: 'https://api.example.com/path' });
  function control(action, data = {}) {
    const button = harness.element(`action-${action}`);
    button.dataset = { ruleAction: action, ...data };
    return button;
  }
  return { ...harness, snapshot, tabs, messages, control };
}

test('scope controls render selected-profile counts, accessible panels, and never include another profile', async (t) => {
  const harness = await setup(t);
  assert.equal(harness.element('currentSiteRuleCount').textContent, 1);
  assert.equal(harness.element('allRulesCount').textContent, 2);
  assert.equal(harness.element('manageRulesLink').textContent, 'Manage profiles and all 4 rules →');
  assert.equal(harness.tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(harness.tabs[0].tabIndex, 0);
  assert.equal(harness.element('ruleListContainer').getAttribute('aria-labelledby'), 'currentSiteTab');
  await harness.element('ruleScopeTabs').dispatch('click', { target: harness.tabs[1] });
  assert.equal(state.headers.scope, 'all');
  assert.equal(harness.tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(harness.tabs[0].tabIndex, -1);
  assert.equal(harness.element('ruleListContainer').getAttribute('aria-labelledby'), 'allRulesTab');
  assert.match(harness.element('ruleListContainer').innerHTML, /X-Other/);
  assert.doesNotMatch(harness.element('ruleListContainer').innerHTML, /X-Environment|staging.example.com/);
});

test('collapse and reveal events update controller-owned state and return to the original display', async (t) => {
  const harness = await setup(t);
  await harness.element('ruleScopeTabs').dispatch('click', { target: harness.tabs[1] });
  const collapse = harness.control('toggle-domain', { domain: 'api.example.com' });
  await harness.element('ruleListContainer').dispatch('click', { target: collapse });
  assert.equal(state.headers.collapsedDomains.has('api.example.com'), true);
  assert.match(
    harness.element('ruleListContainer').innerHTML,
    /aria-expanded="false" aria-controls="domainRuleGroup-0"/
  );
  await harness.element('ruleListContainer').dispatch('click', { target: collapse });
  assert.equal(state.headers.collapsedDomains.has('api.example.com'), false);
  const reveal = harness.control('reveal', { id: '1' });
  assert.doesNotMatch(harness.element('ruleListContainer').innerHTML, /backup-test-secret/);
  await harness.element('ruleListContainer').dispatch('click', { target: reveal });
  assert.equal(state.headers.revealedRuleIds.has(1), true);
  assert.match(harness.element('ruleListContainer').innerHTML, /backup-test-secret/);
  await harness.element('ruleListContainer').dispatch('click', { target: reveal });
  assert.equal(state.headers.revealedRuleIds.has(1), false);
  assert.doesNotMatch(harness.element('ruleListContainer').innerHTML, /backup-test-secret/);
});

test('scope keyboard navigation restores focus and unavailable sites select all rules outside the renderer', async (t) => {
  const harness = await setup(t);
  let prevented = false;
  await harness.element('ruleScopeTabs').dispatch('keydown', {
    target: harness.tabs[0],
    currentTarget: harness.element('ruleScopeTabs'),
    key: 'End',
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.equal(state.headers.scope, 'all');
  assert.equal(document.activeElement, harness.tabs[1]);
  await harness.element('ruleScopeTabs').dispatch('keydown', {
    target: harness.tabs[1],
    currentTarget: harness.element('ruleScopeTabs'),
    key: 'Home',
    preventDefault() {}
  });
  assert.equal(state.headers.scope, 'site');
  await initializeHeaders({ url: 'chrome://extensions/' });
  assert.equal(state.headers.scope, 'all');
  assert.equal(harness.tabs[0].disabled, true);
  assert.equal(harness.tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(harness.element('ruleListContainer').getAttribute('aria-labelledby'), 'allRulesTab');
  assert.equal(harness.element('headerComposerToggle').disabled, true);
  const before = state.headers.scope;
  await harness.element('ruleScopeTabs').dispatch('keydown', {
    target: harness.tabs[1],
    currentTarget: harness.element('ruleScopeTabs'),
    key: 'Home',
    preventDefault() {
      assert.fail('One enabled tab should not intercept navigation.');
    }
  });
  assert.equal(state.headers.scope, before);
});

test('a refreshed snapshot that removed the edited rule resets the composer before rendering the list', async (t) => {
  const harness = await setup(t);
  await harness.element('ruleListContainer').dispatch('click', { target: harness.control('edit', { id: '1' }) });
  assert.equal(state.headers.editingId, 1);
  assert.equal(state.headers.composerOpen, true);
  harness.element('headerValue').value = 'unsaved draft';
  harness.snapshot.rules = harness.snapshot.rules.filter((rule) => rule.id !== 1);
  await refreshFromStorage();
  assert.equal(state.headers.editingId, null);
  assert.equal(state.headers.composerOpen, false);
  assert.equal(harness.element('headerComposer').hidden, true);
  assert.equal(harness.element('headerValue').value, '');
  assert.equal(harness.element('addHeaderBtn').textContent, 'Add rule');
  assert.equal(harness.element('currentSiteRuleCount').textContent, 0);
});

test('empty popup state relies on the footer add action and renderers do not coordinate other components or mutate state', async (t) => {
  const harness = await setup(t);
  const before = structuredClone(state.headers);
  harness.element('masterSwitchLabel').textContent = 'untouched activation';
  harness.element('addHeaderBtn').textContent = 'untouched composer';
  const snapshot = Object.freeze({ ...state.headers, rules: Object.freeze([]), currentHostname: '', scope: 'site' });
  const model = getPopupRuleViewModel(snapshot);
  renderCurrentSiteControls(model);
  renderRules(model);
  assert.equal(harness.element('ruleListContainer').classList.contains('is-empty'), true);
  assert.match(harness.element('ruleListContainer').innerHTML, /No rules in this profile/);
  assert.doesNotMatch(harness.element('ruleListContainer').innerHTML, /data-rule-action="open-composer"/);
  assert.equal(harness.element('headerComposerToggle').disabled, true);
  assert.equal(harness.element('masterSwitchLabel').textContent, 'untouched activation');
  assert.equal(harness.element('addHeaderBtn').textContent, 'untouched composer');
  assert.deepEqual(state.headers, before);
  assert.equal(snapshot.scope, 'site');
});

test('the popup workspace normalizes scope once and explicitly coordinates every rendering step with one model', () => {
  const calls = [];
  const snapshot = { rules: [], scope: 'site', currentHostname: '' };
  let controlModel;
  let listModel;
  const render = createPopupWorkspace({
    getState: () => snapshot,
    setScope: (scope) => {
      calls.push(['scope', scope]);
      snapshot.scope = scope;
    },
    renderMasterSwitch: () => calls.push('master'),
    renderActivationSummary: () => calls.push('activation'),
    renderCurrentSiteControls: (model) => {
      controlModel = model;
      calls.push('controls');
    },
    configureComposer: () => calls.push('composer'),
    renderRules: (model) => {
      listModel = model;
      calls.push('rules');
    }
  });
  assert.deepEqual(calls, []);
  render();
  assert.deepEqual(calls, [['scope', 'all'], 'master', 'activation', 'controls', 'composer', 'rules']);
  assert.equal(controlModel, listModel);
  calls.length = 0;
  render();
  assert.deepEqual(calls, ['master', 'activation', 'controls', 'composer', 'rules']);
});
