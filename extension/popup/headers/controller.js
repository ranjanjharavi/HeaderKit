import {
  RULE_STORAGE_KEY,
  filterRulesByHost,
  filterRulesByProfile,
  findActiveRuleConflict,
  getActiveRuleConflicts,
  getNextRuleId,
  getRuleConflictMessage,
  getRuleOriginPattern,
  groupRulesByDomain,
  validateRuleDraft
} from '../../shared/domain/rules.js';
import {
  createTab,
  getExtensionUrl,
  onStorageChanged,
  openOptionsPage,
  removeOriginPermission,
  requestOriginPermission,
  storageLocalGet
} from '../../shared/runtime/chrome-api.js';
import {
  ACTIVATION_STORAGE_KEY,
  createDefaultActivation,
  getTargetProfileId,
  normalizeActivation
} from '../../shared/domain/activation.js';
import {
  PROFILE_STORAGE_KEY,
  createDefaultProfiles,
  getProfileIds,
  normalizeProfiles
} from '../../shared/domain/profiles.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import { createSiteAccessPreflight } from '../../shared/ui/site-access-preflight.js';
import { saveRuleBeforePermissionPrompt } from '../../shared/runtime/site-access-save.js';
import {
  createConflictMap,
  renderDomainGroup,
  renderRuleRow,
  sortDomainGroups,
  sortRulesForDisplay
} from '../../shared/ui/rule-render.js';
import { parseUserUrl } from '../../shared/domain/urls.js';
import { commitRules, getStoredRules } from '../../shared/runtime/rule-api.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { state, getActivation } from '../state.js';
import {
  bindActivationEvents,
  renderMasterSwitch,
  renderActivationSummary
} from '../activation/controller.js';
import { readGrantedOrigins } from '../../shared/runtime/site-access-api.js';
import { escapeHtml, showStatus } from '../../shared/ui/ui.js';
import { getManagerLinkLabel, getManagerPath } from '../view-model.js';

let siteAccessPreflight;

export function bindHeaderEvents() {
  bindActivationEvents({ onChanged: renderRules });
  document.getElementById('headerComposerToggle').addEventListener('click', toggleHeaderComposer);
  document.getElementById('cancelHeaderComposerBtn').addEventListener('click', cancelHeaderComposer);

  const composerForm = document.getElementById('headerComposerForm');
  siteAccessPreflight = createSiteAccessPreflight({
    getDefaultSubmitLabel: () => state.headers.editingId ? 'Update rule' : 'Add rule'
  });
  composerForm.addEventListener('submit', handleComposerSubmit);
  composerForm.addEventListener('keydown', handleComposerKeydown);

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

/**
 * The popup only ever shows the profile in play. Rules parked in another
 * profile are not applied here, so listing them would misrepresent the site.
 */
function getScopedRules() {
  return filterRulesByProfile(state.headers.rules, getTargetProfileId(getActivation()));
}

/**
 * When the grant list could not be read, say nothing rather than flagging every
 * rule as broken.
 */
function describeRule(rule) {
  const grantedOrigins = state.headers.grantedOrigins;
  return {
    needsAccess: Boolean(grantedOrigins) && !isRuleGranted(rule, grantedOrigins)
  };
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

function openRuleEditor(id) {
  const rule = getScopedRules().find((candidate) => candidate.id === id);
  if (!rule) {
    showStatus('headerStatus', 'That rule is no longer in the active profile.', 'error');
    return;
  }

  state.headers.editingId = id;
  siteAccessPreflight.hide();
  document.getElementById('domain').value = rule.domain;
  document.getElementById('headerName').value = rule.headerName;
  document.getElementById('headerValue').value = rule.headerValue;
  document.getElementById('pathPrefix').value = rule.pathPrefix || '';
  document.getElementById('resourceType').value = rule.resourceType || 'all';
  document.getElementById('requestScopeDetails').open = Boolean(rule.pathPrefix) || rule.resourceType === 'xmlhttprequest';
  configureComposer();
  setHeaderComposerExpanded(true, { focusFirstField: true });
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  const addButton = document.getElementById('addHeaderBtn');
  if (addButton.disabled) {
    return;
  }

  addButton.disabled = true;
  addButton.textContent = state.headers.editingId ? 'Updating…' : 'Adding…';

  try {
    const saved = state.headers.editingId
      ? await saveEditedRule(state.headers.editingId)
      : await addRule();
    if (saved) {
      setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
    }
  } finally {
    addButton.disabled = false;
    configureComposer();
  }
}

function handleComposerKeydown(event) {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
}

function toggleHeaderComposer() {
  if (state.headers.composerOpen) {
    setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
    return;
  }

  openCreateComposer();
}

function cancelHeaderComposer() {
  setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
}

function openCreateComposer() {
  state.headers.editingId = null;
  siteAccessPreflight.hide();
  clearHeaderForm();
  configureComposer();
  setHeaderComposerExpanded(true, { focusFirstField: true });
}

function setHeaderComposerExpanded(expanded, {
  focusFirstField = false,
  reset = false,
  returnFocus = false
} = {}) {
  const composer = document.getElementById('headerComposer');
  const toggle = document.getElementById('headerComposerToggle');

  state.headers.composerOpen = expanded;
  composer.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.disabled = expanded || !state.headers.currentHostname;

  if (reset) {
    state.headers.editingId = null;
    siteAccessPreflight.hide();
    clearHeaderForm();
    configureComposer();
  }

  if (focusFirstField && expanded) {
    const domainInput = document.getElementById('domain');
    const firstField = domainInput.value.trim()
      ? document.getElementById('headerName')
      : domainInput;
    composer.scrollTop = 0;
    firstField.focus({ preventScroll: true });
  } else if (returnFocus && !expanded) {
    toggle.focus();
  }
}

function configureComposer() {
  const editing = Boolean(state.headers.editingId);
  siteAccessPreflight.syncSubmitLabel(editing ? 'Update rule' : 'Add rule');
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

function setRuleScope(scope) {
  state.headers.scope = scope === 'all' ? 'all' : 'site';
  renderRules();
}

function toggleDomain(domain) {
  if (state.headers.collapsedDomains.has(domain)) {
    state.headers.collapsedDomains.delete(domain);
  } else {
    state.headers.collapsedDomains.add(domain);
  }
  renderRules();
}

function renderRules() {
  const { rules, currentHostname } = state.headers;
  const container = document.getElementById('ruleListContainer');
  const conflictMap = createConflictMap(getActiveRuleConflicts(rules, getActivation()));
  const conflictingIds = new Set(conflictMap.keys());
  renderMasterSwitch();
  renderActivationSummary();
  updateCurrentSiteControls();
  configureComposer();

  const scopedRules = getScopedRules();
  const visibleRules = state.headers.scope === 'all'
    ? scopedRules
    : (currentHostname ? filterRulesByHost(scopedRules, currentHostname) : []);
  container.classList.toggle('is-empty', !visibleRules.length);
  if (!visibleRules.length) {
    container.innerHTML = getEmptyRulesMessage();
    return;
  }

  if (state.headers.scope === 'all') {
    const groups = sortDomainGroups(
      groupRulesByDomain(visibleRules),
      conflictingIds,
      currentHostname
    );
    container.innerHTML = `<div class="all-rule-groups">${groups.map((group, index) => renderDomainGroup(
      group.domain,
      group.rules,
      {
        index,
        conflictMap,
        collapsed: state.headers.collapsedDomains.has(group.domain),
        currentHostname,
        revealedRuleIds: state.headers.revealedRuleIds,
        describeRule
      }
    )).join('')}</div>`;
    return;
  }

  const sortedRules = sortRulesForDisplay(visibleRules, conflictingIds);
  container.innerHTML = `
    <div class="current-rule-list" aria-label="Rules for ${escapeHtml(currentHostname)}">
      ${sortedRules.map((rule) => renderRuleRow(rule, {
    conflictingRules: conflictMap.get(rule.id) || [],
    revealed: state.headers.revealedRuleIds.has(rule.id),
    ...describeRule(rule)
  })).join('')}
    </div>
  `;
}

function updateCurrentSiteControls() {
  const { rules, currentHostname } = state.headers;
  const currentSiteHost = document.getElementById('currentSiteHost');
  const scopedRules = getScopedRules();
  const currentSiteCount = currentHostname
    ? filterRulesByHost(scopedRules, currentHostname).length
    : 0;
  const currentSiteTab = document.getElementById('currentSiteTab');

  currentSiteHost.textContent = currentHostname || 'Current site unavailable';
  currentSiteHost.classList.toggle('is-unavailable', !currentHostname);
  document.getElementById('currentSiteRuleCount').textContent = currentSiteCount;
  document.getElementById('allRulesCount').textContent = scopedRules.length;
  currentSiteTab.disabled = !currentHostname;

  if (!currentHostname && state.headers.scope === 'site') {
    state.headers.scope = 'all';
  }

  document.querySelectorAll('[data-rule-scope]').forEach((tab) => {
    const selected = tab.dataset.ruleScope === state.headers.scope;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.getElementById('ruleListContainer').setAttribute(
    'aria-labelledby',
    state.headers.scope === 'all' ? 'allRulesTab' : 'currentSiteTab'
  );

  document.getElementById('headerComposerToggle').disabled = !currentHostname || state.headers.composerOpen;

  document.getElementById('manageRulesLink').textContent = getManagerLinkLabel(rules.length);
}

function getEmptyRulesMessage() {
  const { currentHostname, rules } = state.headers;

  if (state.headers.scope === 'all') {
    return `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M7.25 2.5h1.5v4.75h4.75v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75V2.5Z"/></svg></div>
        <p class="empty-state-title">No rules in this profile</p>
        <p>Add a rule for the current HTTPS site, or manage profiles and rules.</p>
      </div>
    `;
  }

  if (currentHostname) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M7.25 2.5h1.5v4.75h4.75v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75V2.5Z"/></svg></div>
        <p class="empty-state-title">No rules for <code>${escapeHtml(currentHostname)}</code></p>
        <p>Add a rule to modify requests sent to this HTTPS host.</p>
      </div>
    `;
  }

  return `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm7.25-3.5h1.5V6h-1.5V4.5Zm0 3h1.5v4h-1.5v-4Z"/></svg></div>
      <p class="empty-state-title">No site to work with</p>
      <p>Open an HTTPS page to add or review its header rules.</p>
      ${rules.length ? '<button class="secondary-btn empty-state-action" type="button" data-rule-action="open-manager">Open the rule manager</button>' : ''}
    </div>
  `;
}

async function addRule() {
  const activation = getActivation();
  const profileId = getTargetProfileId(activation);
  const validation = validateRuleDraft(readCreateDraft(), state.headers.rules, {
    activation,
    profileId
  });
  if (!validation.ok) {
    showStatus('headerStatus', validation.error, 'error');
    return false;
  }

  const newRule = {
    id: getNextRuleId(state.headers.rules),
    ...validation.rule,
    enabled: true,
    profileId
  };
  const updatedRules = [
    ...state.headers.rules,
    newRule
  ];

  const needsAccess = !isRuleGranted(newRule, state.headers.grantedOrigins);
  if (needsAccess && !siteAccessPreflight.isReadyFor(newRule)) {
    siteAccessPreflight.show(newRule);
    return false;
  }

  try {
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(newRule, updatedRules, {
        persistRules,
        requestPermission: requestOriginPermission
      });
      state.headers.grantedOrigins = await readGrantedOrigins();

      if (!result.granted) {
        if (result.permissionError) {
          console.error('Could not request site access.', result.permissionError);
        }
        renderRules();
        showStatus(
          'headerStatus',
          `Rule saved, but ReqKit still needs site access to https://${newRule.domain} before it can be applied.`,
          'error'
        );
        return true;
      }

      // Re-commit with the refreshed grant list when the popup remains open.
      // The background permission listener covers the popup-close case.
      await persistRules(state.headers.rules);
    } else {
      await persistRules(updatedRules);
    }

    showStatus(
      'headerStatus',
      needsAccess ? 'Site access granted and rule added.' : 'Header rule added.',
      'success'
    );
    return true;
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome rejected the new rule.', 'error');
    return false;
  }
}

async function saveEditedRule(id) {
  const currentRule = state.headers.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    showStatus('headerStatus', 'That rule no longer exists.', 'error');
    return false;
  }

  const profileId = getTargetProfileId(getActivation());
  const validation = validateRuleDraft(readCreateDraft(), state.headers.rules, {
    excludeId: id,
    enabled: currentRule.enabled,
    activation: getActivation(),
    profileId
  });
  if (!validation.ok) {
    showStatus('headerStatus', validation.error, 'error');
    return false;
  }

  const updatedRules = state.headers.rules.map((rule) => (
    rule.id === id ? { ...rule, ...validation.rule, profileId } : rule
  ));
  const updatedRule = updatedRules.find((rule) => rule.id === id);

  try {
    if (updatedRule.enabled) {
      await ensureRulePermission(updatedRule);
    }
    await persistRules(updatedRules);
    if (currentRule.domain !== updatedRule.domain) {
      await releaseUnusedPermission(currentRule, updatedRules);
    }
    state.headers.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Header rule updated.', 'success');
    return true;
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not update that rule.', 'error');
    return false;
  }
}

async function toggleRule(id) {
  const currentRule = state.headers.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    return;
  }

  if (!currentRule.enabled) {
    const conflictingRule = findActiveRuleConflict(
      { ...currentRule, enabled: true },
      state.headers.rules,
      { excludeId: id, activation: getActivation() }
    );
    if (conflictingRule) {
      showStatus('headerStatus', getRuleConflictMessage(conflictingRule), 'error');
      return;
    }

    try {
      await ensureRulePermission(currentRule);
    } catch (error) {
      console.error(error);
      showStatus('headerStatus', error.message, 'error');
      return;
    }
  }

  const updatedRules = state.headers.rules.map((rule) => (
    rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
  ));

  try {
    await persistRules(updatedRules);
    const toggledRule = state.headers.rules.find((rule) => rule.id === id);
    showStatus('headerStatus', toggledRule?.enabled ? 'Rule resumed.' : 'Rule paused.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not toggle that rule.', 'error');
  }
}

async function confirmDeleteRule(id) {
  const rule = state.headers.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  const confirmed = await confirmDestructiveAction({
    title: `Delete ${rule.headerName}?`,
    message: `The rule for ${rule.domain} will be permanently removed.`,
    confirmLabel: 'Delete rule'
  });
  if (confirmed) {
    await deleteRule(id);
  }
}

async function deleteRule(id) {
  const ruleToDelete = state.headers.rules.find((rule) => rule.id === id);
  if (!ruleToDelete) {
    return;
  }

  try {
    const updatedRules = state.headers.rules.filter((rule) => rule.id !== id);
    await persistRules(updatedRules);
    await releaseUnusedPermission(ruleToDelete, updatedRules);
    state.headers.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Rule removed.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not remove that rule.', 'error');
  }
}

function toggleRuleValueVisibility(id) {
  if (state.headers.revealedRuleIds.has(id)) {
    state.headers.revealedRuleIds.delete(id);
  } else {
    state.headers.revealedRuleIds.add(id);
  }
  renderRules();
}

async function grantRuleAccess(id) {
  const rule = state.headers.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  try {
    await ensureRulePermission(rule);
    state.headers.grantedOrigins = await readGrantedOrigins();
    // Re-commit so the worker rebuilds the rule set now that access exists.
    await persistRules(state.headers.rules);
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

async function ensureRulePermission(rule) {
  const granted = await requestOriginPermission(getRuleOriginPattern(rule));
  if (!granted) {
    throw new Error(`Site access to https://${rule.domain} is required to resume this rule.`);
  }
}

async function releaseUnusedPermission(rule, remainingRules) {
  if (remainingRules.some((candidate) => candidate.domain === rule.domain)) {
    return;
  }

  try {
    await removeOriginPermission(getRuleOriginPattern(rule));
  } catch (error) {
    console.error(`Could not release site access for ${rule.domain}.`, error);
  }
}

/**
 * The storage listener would otherwise fire on this page's own write and reset
 * transient UI such as revealed values.
 */
async function persistRules(rules) {
  state.headers.syncPaused = true;
  try {
    state.headers.rules = await commitRules(rules);
    renderRules();
  } finally {
    state.headers.syncPaused = false;
  }
}

function readCreateDraft() {
  return {
    domain: document.getElementById('domain').value,
    headerName: document.getElementById('headerName').value,
    headerValue: document.getElementById('headerValue').value,
    pathPrefix: document.getElementById('pathPrefix').value,
    resourceType: document.getElementById('resourceType').value
  };
}

function clearHeaderForm() {
  document.getElementById('domain').value = state.headers.currentHostname;
  document.getElementById('headerName').value = '';
  document.getElementById('headerValue').value = '';
  document.getElementById('pathPrefix').value = '';
  document.getElementById('resourceType').value = 'all';
  document.getElementById('requestScopeDetails').open = false;
}
