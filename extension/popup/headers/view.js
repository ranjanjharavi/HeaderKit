import { renderDomainGroup, renderRuleRow } from '../../shared/ui/rule-render.js';
import { escapeHtml } from '../../shared/ui/ui.js';

export function renderRules(model) {
  const container = document.getElementById('ruleListContainer');
  container.classList.toggle('is-empty', !model.visibleRuleCount);
  if (!model.visibleRuleCount) {
    container.innerHTML = getEmptyRulesMessage(model);
    return;
  }
  if (model.scope === 'all') {
    container.innerHTML = `<div class="all-rule-groups">${model.groups.map(renderDomainGroup).join('')}</div>`;
    return;
  }
  container.innerHTML = `
    <div class="current-rule-list" aria-label="Rules for ${escapeHtml(model.currentHostname)}">
      ${model.rows.map(({ rule, options }) => renderRuleRow(rule, options)).join('')}
    </div>
  `;
}

export function renderCurrentSiteControls(model) {
  const { currentHostname, scope } = model;
  const currentSiteHost = document.getElementById('currentSiteHost');
  currentSiteHost.textContent = currentHostname || 'Current site unavailable';
  currentSiteHost.classList.toggle('is-unavailable', !currentHostname);
  document.getElementById('currentSiteRuleCount').textContent = model.currentSiteCount;
  document.getElementById('allRulesCount').textContent = model.allRulesCount;
  document.getElementById('currentSiteTab').disabled = !currentHostname;
  document.querySelectorAll('[data-rule-scope]').forEach((tab) => {
    const selected = tab.dataset.ruleScope === scope;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document
    .getElementById('ruleListContainer')
    .setAttribute('aria-labelledby', scope === 'all' ? 'allRulesTab' : 'currentSiteTab');
  document.getElementById('headerComposerToggle').disabled = model.addRuleDisabled;
  document.getElementById('manageRulesLink').textContent = model.managerLinkLabel;
}

function getEmptyRulesMessage({ scope, currentHostname, hasRules }) {
  if (scope === 'all') {
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
      ${hasRules ? '<button class="secondary-btn empty-state-action" type="button" data-rule-action="open-manager">Open the rule manager</button>' : ''}
    </div>
  `;
}
