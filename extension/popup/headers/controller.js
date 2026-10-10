import { RULE_STORAGE_KEY } from '../../shared/domain/rules.js';
import {
  createTab,
  getExtensionUrl,
  onStorageChanged,
  openOptionsPage,
  storageLocalGet
} from '../../shared/runtime/chrome-api.js';
import {
  ACTIVATION_STORAGE_KEY,
  createDefaultActivation,
  normalizeActivation
} from '../../shared/domain/activation.js';
import {
  PROFILE_STORAGE_KEY,
  createDefaultProfiles,
  getProfileIds,
  normalizeProfiles
} from '../../shared/domain/profiles.js';
import { parseUserUrl } from '../../shared/domain/urls.js';
import { getStoredRules } from '../../shared/runtime/rule-api.js';
import { state, getScopedRules } from '../state.js';
import { bindActivationEvents } from '../activation/controller.js';
import { readGrantedOrigins } from '../../shared/runtime/site-access-api.js';
import { getManagerPath } from '../view-model.js';
import { addRule, saveEditedRule, toggleRule, confirmDeleteRule, grantRuleAccess } from './actions.js';
import {
  bindComposerEvents,
  openRuleEditor,
  openCreateComposer,
  setHeaderComposerExpanded
} from './composer.js';
import { renderRules, setRuleScope, toggleDomain, toggleRuleValueVisibility } from './view.js';

export function bindHeaderEvents() {
  bindActivationEvents({ onChanged: renderRules });
  bindComposerEvents({ onAddRule: addRule, onSaveRule: saveEditedRule });

  document.getElementById('manageRulesLink').addEventListener('click', (event) => {
    event.preventDefault();
    openManager();
  });
  document.getElementById('changeActiveSetupBtn').addEventListener('click', openActiveSetup);
  document.getElementById('ruleScopeTabs').addEventListener('click', handleScopeTabClick);
  document.getElementById('ruleScopeTabs').addEventListener('keydown', handleScopeTabKeydown);

  document.getElementById('ruleListContainer').addEventListener('click', handleRuleListClick);

  onStorageChanged((changes) => {
    const touchesRules = RULE_STORAGE_KEY in changes
      || ACTIVATION_STORAGE_KEY in changes
      || PROFILE_STORAGE_KEY in changes;

    if (touchesRules && !state.headers.syncPaused) {
      refreshFromStorage().catch((error) => {
        console.error('Could not refresh header rules.', error);
      });
    }
  });
}

export async function initializeHeaders(activeTab) {
  initializeCurrentSite(activeTab);
  await refreshFromStorage();
}

async function refreshFromStorage() {
  await loadActivation();
  state.headers.rules = await getStoredRules();
  if (state.headers.editingId && !getScopedRules().some((rule) => rule.id === state.headers.editingId)) {
    setHeaderComposerExpanded(false, { reset: true });
  }
  renderRules();
}

async function loadActivation() {
  try {
    const stored = await storageLocalGet([PROFILE_STORAGE_KEY, ACTIVATION_STORAGE_KEY]);
    const profiles = normalizeProfiles(stored[PROFILE_STORAGE_KEY]);
    state.headers.profiles = profiles;
    state.headers.activation = normalizeActivation(stored[ACTIVATION_STORAGE_KEY], {
      profileIds: getProfileIds(profiles)
    });
  } catch (error) {
    console.error('Could not read the activation state.', error);
    state.headers.profiles = createDefaultProfiles();
    state.headers.activation = createDefaultActivation();
  }

  state.headers.grantedOrigins = await readGrantedOrigins();
}

function openManager() {
  openOptionsPage().catch((error) => {
    console.error('Could not open the ReqKit manager.', error);
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
      toggleRule(Number(button.dataset.id));
      break;
    case 'reveal':
      toggleRuleValueVisibility(Number(button.dataset.id));
      break;
    case 'grant':
      grantRuleAccess(Number(button.dataset.id));
      break;
    case 'delete':
      confirmDeleteRule(Number(button.dataset.id));
      break;
    default:
      break;
  }
}

function initializeCurrentSite(activeTab) {
  const tabUrl = activeTab?.url || '';
  if (!/^https:\/\//i.test(tabUrl)) {
    state.headers.currentHostname = '';
    return;
  }

  const parsed = parseUserUrl(tabUrl);
  state.headers.currentHostname = parsed.url.hostname.toLowerCase();
  document.getElementById('domain').value = state.headers.currentHostname;
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
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  setRuleScope(tabs[nextIndex].dataset.ruleScope);
  tabs[nextIndex].focus();
}
