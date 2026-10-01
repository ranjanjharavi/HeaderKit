import {
  filterRulesByProfile,
  findActiveRuleConflict,
  getActiveRuleConflicts,
  getNextRuleId,
  getRuleConflictMessage,
  getRuleOriginPattern,
  groupRulesByDomain,
  validateRuleDraft
} from '../../shared/domain/rules.js';
import { removeOriginPermission, requestOriginPermission } from '../../shared/runtime/chrome-api.js';
import { getTargetProfileId } from '../../shared/domain/activation.js';
import { resolveProfileId } from '../../shared/domain/profiles.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import { createSiteAccessPreflight } from '../../shared/ui/site-access-preflight.js';
import { saveRuleBeforePermissionPrompt } from '../../shared/runtime/site-access-save.js';
import { createConflictMap, renderDomainGroup, sortDomainGroups } from '../../shared/ui/rule-render.js';
import { commitRules } from '../../shared/runtime/rule-api.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { state, getActivation } from '../state.js';
import { readGrantedOrigins } from '../../shared/runtime/site-access-api.js';
import { showStatus } from '../../shared/ui/ui.js';
import { getRuleWorkspaceSummary } from '../view-model.js';

const SEARCH_VISIBLE_FROM = 5;
let siteAccessPreflight;
let refreshWorkspace;
let renderWorkspace;

export function bindRuleEvents({ onRefresh, onRender }) {
  refreshWorkspace = onRefresh;
  renderWorkspace = onRender;
  document.getElementById('headerComposerToggle').addEventListener('click', toggleHeaderComposer);
  document.getElementById('cancelHeaderComposerBtn').addEventListener('click', cancelHeaderComposer);

  const composerForm = document.getElementById('headerComposerForm');
  siteAccessPreflight = createSiteAccessPreflight();
  composerForm.addEventListener('submit', handleComposerSubmit);
  composerForm.addEventListener('keydown', handleComposerKeydown);

  const ruleList = document.getElementById('ruleListContainer');
  ruleList.addEventListener('click', handleRuleListClick);
  ruleList.addEventListener('submit', handleRuleFormSubmit);
  ruleList.addEventListener('keydown', handleRuleFormKeydown);
  document.getElementById('ruleSearchInput').addEventListener('input', handleRuleSearchInput);

}

export async function initializeRules({ editRuleId = null } = {}) {
  await refreshWorkspace();

  if (editRuleId && state.rules.some((rule) => rule.id === editRuleId)) {
    startEditingRule(editRuleId);
    document.querySelector('.rule-edit-form')?.scrollIntoView({ block: 'center' });
  }
}

function getVisibleRules() {
  return filterRulesByProfile(state.rules, getTargetProfileId(getActivation()));
}

/**
 * When the grant list could not be read, say nothing rather than flagging every
 * rule as broken.
 */
function describeRule(rule) {
  return {
    needsAccess: Boolean(state.grantedOrigins) && !isRuleGranted(rule, state.grantedOrigins)
  };
}

async function grantRuleAccess(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  try {
    await ensureRulePermission(rule);
    state.grantedOrigins = await readGrantedOrigins();
    await persistRules(state.rules);
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

function handleRuleListClick(event) {
  const button = event.target.closest('[data-rule-action]');
  if (!button) {
    return;
  }

  switch (button.dataset.ruleAction) {
    case 'open-composer':
      setHeaderComposerExpanded(true, { focusFirstField: true });
      break;
    case 'clear-search':
      clearRuleSearch();
      break;
    case 'toggle-domain':
      toggleDomainGroup(button.dataset.domain);
      break;
    case 'edit':
      startEditingRule(Number(button.dataset.id));
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
    case 'cancel-edit':
      state.editingId = null;
      renderWorkspace();
      break;
    default:
      break;
  }
}

function handleRuleSearchInput(event) {
  state.searchQuery = event.target.value;
  renderWorkspace();
}

async function handleRuleFormSubmit(event) {
  const form = event.target.closest('.rule-edit-form');
  if (!form) {
    return;
  }

  event.preventDefault();
  const id = Number(form.dataset.id);
  const buttons = form.querySelectorAll('button');
  const saveButton = form.querySelector('.save-edit-rule-btn');

  buttons.forEach((button) => {
    button.disabled = true;
  });
  saveButton.textContent = 'Saving…';

  try {
    await saveEditedRule(id);
  } finally {
    if (saveButton.isConnected) {
      buttons.forEach((button) => {
        button.disabled = false;
      });
      saveButton.textContent = 'Save changes';
    }
  }
}

function handleRuleFormKeydown(event) {
  if (event.key !== 'Escape' || !event.target.closest('.rule-edit-form')) {
    return;
  }

  event.preventDefault();
  state.editingId = null;
  renderWorkspace();
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  const addButton = document.getElementById('addHeaderBtn');
  if (addButton.disabled) {
    return;
  }

  addButton.disabled = true;
  addButton.textContent = 'Adding…';

  try {
    if (await addRule()) {
      setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
    }
  } finally {
    addButton.disabled = false;
    siteAccessPreflight.syncSubmitLabel('Add rule');
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
  setHeaderComposerExpanded(!state.composerOpen, { focusFirstField: !state.composerOpen });
}

function cancelHeaderComposer() {
  setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
}

function setHeaderComposerExpanded(expanded, {
  focusFirstField = false,
  reset = false,
  returnFocus = false
} = {}) {
  const composer = document.getElementById('headerComposer');
  const toggle = document.getElementById('headerComposerToggle');

  state.composerOpen = expanded;
  if (expanded) {
    state.editingId = null;
  }
  composer.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  syncAddRuleActions();

  if (reset) {
    siteAccessPreflight.hide();
    clearHeaderForm();
  }

  if (focusFirstField && expanded) {
    document.getElementById('domain').focus();
  } else if (returnFocus && !expanded) {
    toggle.focus();
  }
}

export function renderRules() {
  const container = document.getElementById('ruleListContainer');
  const conflictMap = createConflictMap(getActiveRuleConflicts(state.rules, getActivation()));
  const conflictingIds = new Set(conflictMap.keys());
  updateSummary();

  const visibleRules = filterRulesBySearch(getVisibleRules(), state.searchQuery);
  if (!visibleRules.length) {
    container.innerHTML = getEmptyRulesMessage();
    syncAddRuleActions();
    return;
  }

  const groups = sortDomainGroups(groupRulesByDomain(visibleRules), conflictingIds, '');
  container.innerHTML = groups.map(({ domain, rules: domainRules }, index) => renderDomainGroup(
    domain,
    domainRules,
    {
      index,
      conflictMap,
      collapsed: state.collapsedDomains.has(domain),
      editingId: state.editingId,
      revealedRuleIds: state.revealedRuleIds,
      editProfiles: state.profiles,
      managerView: true,
      describeRule
    }
  )).join('');
  syncAddRuleActions();
}

function syncAddRuleActions() {
  const disabled = state.composerOpen || state.editingId !== null;
  document.getElementById('headerComposerToggle').disabled = disabled;

  document.querySelectorAll('[data-rule-action="open-composer"]').forEach((button) => {
    button.disabled = disabled;
  });
}

function updateSummary() {
  const scopedRules = getVisibleRules();
  const summary = getRuleWorkspaceSummary(scopedRules);

  document.getElementById('rulesCount').textContent = String(summary.totalRules);
  document.getElementById('optionsSummary').textContent = summary.detail;

  const searchContainer = document.getElementById('ruleSearchContainer');
  const searchInput = document.getElementById('ruleSearchInput');
  const searchEnabled = summary.totalRules >= SEARCH_VISIBLE_FROM;

  searchContainer.hidden = !searchEnabled;
  document.getElementById('rulesToolbar').hidden = !searchEnabled;
  if (!searchEnabled) {
    state.searchQuery = '';
  }
  if (searchInput.value !== state.searchQuery) {
    searchInput.value = state.searchQuery;
  }
}

function filterRulesBySearch(rules, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return rules;
  }

  return rules.filter((rule) => [rule.domain, rule.headerName].some((value) => (
    String(value).toLowerCase().includes(normalizedQuery)
  )));
}

function getEmptyRulesMessage() {
  if (state.searchQuery.trim()) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M7 2a5 5 0 1 0 3.16 8.87l2.98 2.98 1.06-1.06-2.98-2.98A5 5 0 0 0 7 2Zm-3.5 5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"/></svg></div>
        <p class="empty-state-title">No matching rules</p>
        <p>Try a different host or header.</p>
        <button class="secondary-btn empty-state-action" type="button" data-rule-action="clear-search">Clear search</button>
      </div>
    `;
  }

  return `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M7.25 2.5h1.5v4.75h4.75v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75V2.5Z"/></svg></div>
      <p class="empty-state-title">No header rules yet</p>
      <p>Add your first exact-host rule.</p>
      <button class="primary-btn empty-state-action" type="button" data-rule-action="open-composer">Add header rule</button>
    </div>
  `;
}

function toggleDomainGroup(domain) {
  if (!domain) {
    return;
  }

  if (state.collapsedDomains.has(domain)) {
    state.collapsedDomains.delete(domain);
  } else {
    state.collapsedDomains.add(domain);
  }
  renderWorkspace();
}

function startEditingRule(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  setHeaderComposerExpanded(false, { reset: true });
  state.editingId = id;
  state.collapsedDomains.delete(rule.domain);
  renderWorkspace();
  const domainInput = document.getElementById(`editDomain-${id}`);
  domainInput?.focus();
  domainInput?.select();
}

function toggleRuleValueVisibility(id) {
  if (state.revealedRuleIds.has(id)) {
    state.revealedRuleIds.delete(id);
  } else {
    state.revealedRuleIds.add(id);
  }
  renderWorkspace();
}

async function addRule() {
  const activation = getActivation();
  // New rules belong to the selected profile, which is also the profile shown
  // in the manager's rule list.
  const profileId = getTargetProfileId(activation);
  const validation = validateRuleDraft(readCreateDraft(), state.rules, { activation, profileId });
  if (!validation.ok) {
    showStatus('headerStatus', validation.error, 'error');
    return false;
  }

  const newRule = {
    id: getNextRuleId(state.rules),
    ...validation.rule,
    enabled: true,
    profileId
  };

  const needsAccess = !isRuleGranted(newRule, state.grantedOrigins);
  if (needsAccess && !siteAccessPreflight.isReadyFor(newRule)) {
    siteAccessPreflight.show(newRule);
    return false;
  }

  try {
    const updatedRules = [...state.rules, newRule];
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(newRule, updatedRules, {
        persistRules,
        requestPermission: requestOriginPermission
      });
      state.grantedOrigins = await readGrantedOrigins();

      if (!result.granted) {
        if (result.permissionError) {
          console.error('Could not request site access.', result.permissionError);
        }
        renderWorkspace();
        showStatus(
          'headerStatus',
          `Rule saved, but ReqKit still needs site access to https://${newRule.domain} before it can be applied.`,
          'error'
        );
        return true;
      }

      await persistRules(state.rules);
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

async function toggleRule(id) {
  const currentRule = state.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    return;
  }

  if (!currentRule.enabled) {
    const conflictingRule = findActiveRuleConflict(
      { ...currentRule, enabled: true },
      state.rules,
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

  const updatedRules = state.rules.map((rule) => (
    rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
  ));

  try {
    await persistRules(updatedRules);
    const toggledRule = state.rules.find((rule) => rule.id === id);
    showStatus('headerStatus', toggledRule?.enabled ? 'Rule resumed.' : 'Rule paused.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not toggle that rule.', 'error');
  }
}

async function saveEditedRule(id) {
  const statusId = `ruleEditStatus-${id}`;
  const currentRule = state.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    state.editingId = null;
    renderWorkspace();
    showStatus('headerStatus', 'That rule no longer exists.', 'error');
    return;
  }

  const draft = readEditDraft(id);
  const nextProfileId = resolveProfileId(draft.profileId ?? currentRule.profileId);
  const validation = validateRuleDraft(draft, state.rules, {
    excludeId: id,
    enabled: currentRule.enabled,
    activation: getActivation(),
    profileId: nextProfileId
  });
  if (!validation.ok) {
    showStatus(statusId, validation.error, 'error');
    return;
  }

  const updatedRules = state.rules.map((rule) => (
    rule.id === id ? { ...rule, ...validation.rule, profileId: nextProfileId } : rule
  ));
  const updatedRule = updatedRules.find((rule) => rule.id === id);

  try {
    if (updatedRule.enabled) {
      await ensureRulePermission(updatedRule);
    }
    state.editingId = null;
    state.revealedRuleIds.delete(id);
    await persistRules(updatedRules);
    if (currentRule.domain !== updatedRule.domain) {
      await releaseUnusedPermission(currentRule, updatedRules);
    }
    showStatus('headerStatus', 'Header rule updated.', 'success');
  } catch (error) {
    state.editingId = id;
    console.error(error);
    showStatus(statusId, error.message || 'Could not update that rule.', 'error');
  }
}

async function confirmDeleteRule(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
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
  const ruleToDelete = state.rules.find((rule) => rule.id === id);
  if (!ruleToDelete) {
    return;
  }

  try {
    const updatedRules = state.rules.filter((rule) => rule.id !== id);
    await persistRules(updatedRules);
    await releaseUnusedPermission(ruleToDelete, updatedRules);
    state.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Rule removed.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not remove that rule.', 'error');
  }
}

function clearRuleSearch() {
  state.searchQuery = '';
  const searchInput = document.getElementById('ruleSearchInput');
  searchInput.value = '';
  renderWorkspace();
  searchInput.focus();
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
 * The storage listener would otherwise fire on this page's own write and close
 * an open edit form underneath the user.
 */
async function persistRules(rules) {
  state.syncPaused = true;
  try {
    state.rules = await commitRules(rules);
    renderWorkspace();
  } finally {
    state.syncPaused = false;
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

function readEditDraft(id) {
  return {
    domain: document.getElementById(`editDomain-${id}`).value,
    headerName: document.getElementById(`editHeaderName-${id}`).value,
    headerValue: document.getElementById(`editHeaderValue-${id}`).value,
    pathPrefix: document.getElementById(`editPathPrefix-${id}`).value,
    resourceType: document.getElementById(`editResourceType-${id}`).value,
    profileId: document.getElementById(`editProfile-${id}`)?.value
  };
}

function clearHeaderForm() {
  document.getElementById('domain').value = '';
  document.getElementById('headerName').value = '';
  document.getElementById('headerValue').value = '';
  document.getElementById('pathPrefix').value = '';
  document.getElementById('resourceType').value = 'all';
  document.getElementById('requestScopeDetails').open = false;
}
