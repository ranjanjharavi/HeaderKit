import { filterRulesByHost, getActiveRuleConflicts, groupRulesByDomain } from '../../shared/domain/rules.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import {
  createConflictMap,
  renderDomainGroup,
  renderRuleRow,
  sortDomainGroups,
  sortRulesForDisplay
} from '../../shared/ui/rule-render.js';
import { state, getActivation, getScopedRules } from '../state.js';
import { renderMasterSwitch, renderActivationSummary } from '../activation/controller.js';
import { escapeHtml } from '../../shared/ui/ui.js';
import { getManagerLinkLabel } from '../view-model.js';
import { configureComposer } from './composer.js';

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

export function setRuleScope(scope) {
  state.headers.scope = scope === 'all' ? 'all' : 'site';
  renderRules();
}

export function toggleDomain(domain) {
  if (state.headers.collapsedDomains.has(domain)) {
    state.headers.collapsedDomains.delete(domain);
  } else {
    state.headers.collapsedDomains.add(domain);
  }
  renderRules();
}

export function renderRules() {
  const { rules, currentHostname } = state.headers;
  const container = document.getElementById('ruleListContainer');
  const conflictMap = createConflictMap(getActiveRuleConflicts(rules, getActivation()));
  const conflictingIds = new Set(conflictMap.keys());
  renderMasterSwitch();
  renderActivationSummary();
  updateCurrentSiteControls();
  configureComposer();

  const scopedRules = getScopedRules();
  const visibleRules =
    state.headers.scope === 'all'
      ? scopedRules
      : currentHostname
        ? filterRulesByHost(scopedRules, currentHostname)
        : [];
  container.classList.toggle('is-empty', !visibleRules.length);
  if (!visibleRules.length) {
    container.innerHTML = getEmptyRulesMessage();
    return;
  }

  if (state.headers.scope === 'all') {
    const groups = sortDomainGroups(groupRulesByDomain(visibleRules), conflictingIds, currentHostname);
    container.innerHTML = `<div class="all-rule-groups">${groups
      .map((group, index) =>
        renderDomainGroup(group.domain, group.rules, {
          index,
          conflictMap,
          collapsed: state.headers.collapsedDomains.has(group.domain),
          currentHostname,
          revealedRuleIds: state.headers.revealedRuleIds,
          describeRule
        })
      )
      .join('')}</div>`;
    return;
  }

  const sortedRules = sortRulesForDisplay(visibleRules, conflictingIds);
  container.innerHTML = `
    <div class="current-rule-list" aria-label="Rules for ${escapeHtml(currentHostname)}">
      ${sortedRules
        .map((rule) =>
          renderRuleRow(rule, {
            conflictingRules: conflictMap.get(rule.id) || [],
            revealed: state.headers.revealedRuleIds.has(rule.id),
            ...describeRule(rule)
          })
        )
        .join('')}
    </div>
  `;
}

function updateCurrentSiteControls() {
  const { rules, currentHostname } = state.headers;
  const currentSiteHost = document.getElementById('currentSiteHost');
  const scopedRules = getScopedRules();
  const currentSiteCount = currentHostname ? filterRulesByHost(scopedRules, currentHostname).length : 0;
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
  document
    .getElementById('ruleListContainer')
    .setAttribute('aria-labelledby', state.headers.scope === 'all' ? 'allRulesTab' : 'currentSiteTab');

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

export function toggleRuleValueVisibility(id) {
  if (state.headers.revealedRuleIds.has(id)) {
    state.headers.revealedRuleIds.delete(id);
  } else {
    state.headers.revealedRuleIds.add(id);
  }
  renderRules();
}
