import { RULE_STORAGE_KEY, normalizeDomain } from '../../shared/domain/rules.js';
import { createTab, getExtensionUrl, onStorageChanged, openOptionsPage } from '../../shared/runtime/chrome-api.js';
import { ACTIVATION_STORAGE_KEY } from '../../shared/domain/activation.js';
import { PROFILE_STORAGE_KEY } from '../../shared/domain/profiles.js';
import { createStateRefresh } from '../../shared/runtime/state-api.js';
import { state } from '../state.js';
import { getNextTabIndex } from '../../shared/ui/ui.js';
import { bindActivationEvents } from '../activation/controller.js';
import { getManagerPath } from '../view-model.js';
import {
  configureRuleActions,
  addRule,
  saveEditedRule,
  toggleRule,
  confirmDeleteRule,
  grantRuleAccess
} from './actions.js';
import { bindComposerEvents, openRuleEditor, openCreateComposer, setHeaderComposerExpanded } from './composer.js';
import { renderWorkspace } from '../workspace.js';

export function bindHeaderEvents() {
  configureRuleActions({ onRefresh: refreshFromStorage, onRender: renderWorkspace });
  bindActivationEvents({ onChanged: refreshFromStorage });
  bindComposerEvents({ onAddRule: addRule, onSaveRule: saveEditedRule });

  document.getElementById('manageRulesLink').addEventListener('click', (event) => {
    event.preventDefault();
    openManager();
  });
  document.getElementById('changeActiveSetupBtn').addEventListener('click', openActiveSetup);
  document.getElementById('ruleScopeTabs').addEventListener('click', handleScopeTabClick);
  document.getElementById('ruleScopeTabs').addEventListener('keydown', handleScopeTabKeydown);

  document.getElementById('ruleListContainer').addEventListener('click', handleRuleListClick);

  chrome.permissions.onAdded.addListener(scheduleRefresh);
  chrome.permissions.onRemoved.addListener(scheduleRefresh);

  onStorageChanged((changes) => {
    const touchesRules =
      RULE_STORAGE_KEY in changes || ACTIVATION_STORAGE_KEY in changes || PROFILE_STORAGE_KEY in changes;

    if (touchesRules) {
      scheduleRefresh();
    }
  });
}

export async function initializeHeaders(activeTab) {
  initializeCurrentSite(activeTab);
  await refreshFromStorage();
}

export const { refresh: refreshFromStorage, schedule: scheduleRefresh } = createStateRefresh((snapshot) => {
  Object.assign(state.headers, snapshot);
  if (state.headers.editingId && !state.headers.rules.some((rule) => rule.id === state.headers.editingId)) {
    setHeaderComposerExpanded(false, { reset: true });
  }
  renderWorkspace();
});

function openManager() {
  openOptionsPage().catch((error) => {
    console.error('Could not open the HeaderKit manager.', error);
  });
}

function openActiveSetup() {
  createTab({ url: getExtensionUrl(getManagerPath({ section: 'active-setup' })) }).catch((error) => {
    console.error('Could not open the active setup.', error);
  });
}

function handleRuleListClick(event) {
  const button = event.target.closest('[data-rule-action]');
  if (!button) {
    return;
  }

  switch (button.dataset.ruleAction) {
    case 'open-composer':
      openCreateComposer();
      break;
    case 'open-manager':
      openManager();
      break;
    case 'edit':
      openRuleEditor(Number(button.dataset.id));
      break;
    case 'toggle-domain':
      toggleDomain(button.dataset.domain);
      break;
    case 'toggle':
      void toggleRule(Number(button.dataset.id));
      break;
    case 'reveal':
      toggleRuleValueVisibility(Number(button.dataset.id));
      break;
    case 'grant':
      void grantRuleAccess(Number(button.dataset.id));
      break;
    case 'delete':
      void confirmDeleteRule(Number(button.dataset.id));
      break;
    default:
      break;
  }
}

function initializeCurrentSite(activeTab) {
  const tabUrl = activeTab?.url || '';
  state.headers.currentHostname = /^https:\/\//i.test(tabUrl) ? normalizeDomain(tabUrl) : '';
  document.getElementById('domain').value = state.headers.currentHostname;
}

function setRuleScope(scope) {
  state.headers.scope = scope === 'all' ? 'all' : 'site';
  renderWorkspace();
}

function toggleDomain(domain) {
  if (state.headers.collapsedDomains.has(domain)) {
    state.headers.collapsedDomains.delete(domain);
  } else {
    state.headers.collapsedDomains.add(domain);
  }
  renderWorkspace();
}

function toggleRuleValueVisibility(id) {
  if (state.headers.revealedRuleIds.has(id)) {
    state.headers.revealedRuleIds.delete(id);
  } else {
    state.headers.revealedRuleIds.add(id);
  }
  renderWorkspace();
}

function handleScopeTabClick(event) {
  const tab = event.target.closest('[data-rule-scope]');
  if (!tab || tab.disabled) {
    return;
  }

  setRuleScope(tab.dataset.ruleScope);
}

function handleScopeTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }

  const tabs = [...event.currentTarget.querySelectorAll('[data-rule-scope]:not(:disabled)')];
  const currentIndex = tabs.indexOf(event.target.closest('[data-rule-scope]'));
  if (currentIndex < 0 || tabs.length < 2) {
    return;
  }

  event.preventDefault();
  const nextIndex = getNextTabIndex(event.key, currentIndex, tabs.length);
  setRuleScope(tabs[nextIndex].dataset.ruleScope);
  tabs[nextIndex].focus();
}
