import { filterRulesByProfile, getActiveRuleConflicts, groupRulesByDomain } from '../../shared/domain/rules.js';
import { getTargetProfileId } from '../../shared/domain/activation.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import { createConflictMap, renderDomainGroup, sortDomainGroups } from '../../shared/ui/rule-render.js';
import { state, getActivation } from '../state.js';
import { getRuleWorkspaceSummary } from '../view-model.js';

const SEARCH_VISIBLE_FROM = 5;

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

export function renderRules() {
  const container = document.getElementById('ruleListContainer');
  const previousForm = container.querySelector('.rule-edit-form');
  const preservedForm = Number(previousForm?.dataset.id) === state.editingId ? previousForm : null;
  const focusedInput = preservedForm?.contains(document.activeElement) ? document.activeElement : null;
  const selectionStart = focusedInput?.selectionStart;
  const selectionEnd = focusedInput?.selectionEnd;
  const conflictMap = createConflictMap(getActiveRuleConflicts(state.rules, getActivation()));
  const conflictingIds = new Set(conflictMap.keys());
  updateSummary();

  const visibleRules = filterRulesBySearch(getVisibleRules(), state.searchQuery);
  const editingRule = state.rules.find((rule) => rule.id === state.editingId);
  if (editingRule && !visibleRules.some((rule) => rule.id === editingRule.id)) {
    visibleRules.push(editingRule);
  }
  if (!visibleRules.length) {
    container.innerHTML = getEmptyRulesMessage();
    syncAddRuleActions();
    return;
  }

  const groups = sortDomainGroups(groupRulesByDomain(visibleRules), conflictingIds, '');
  container.innerHTML = groups
    .map(({ domain, rules: domainRules }, index) =>
      renderDomainGroup(domain, domainRules, {
        index,
        conflictMap,
        collapsed: state.collapsedDomains.has(domain),
        editingId: state.editingId,
        revealedRuleIds: state.revealedRuleIds,
        editProfiles: state.profiles,
        managerView: true,
        describeRule
      })
    )
    .join('');
  const replacement = container.querySelector('.rule-edit-form');
  if (preservedForm && replacement) {
    replacement.replaceWith(preservedForm);
    focusedInput?.focus({ preventScroll: true });
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      focusedInput.setSelectionRange(selectionStart, selectionEnd);
    }
  }
  syncAddRuleActions();
}

export function syncAddRuleActions() {
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
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase();
  if (!normalizedQuery) {
    return rules;
  }

  return rules.filter((rule) =>
    [rule.domain, rule.headerName].some((value) => String(value).toLowerCase().includes(normalizedQuery))
  );
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
