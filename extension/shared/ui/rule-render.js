import { escapeHtml } from './ui.js';

const ICON_EDIT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m11.85 1.65 2.5 2.5a1.2 1.2 0 0 1 0 1.7l-7.8 7.8-4.05.85.85-4.05 7.8-7.8a1.2 1.2 0 0 1 1.7 0ZM4.7 11.2l-.35 1.45 1.45-.35 7.45-7.45-2.5-2.5L4.7 11.2Z"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.25 2.5h3.5l.5 1H13a.75.75 0 0 1 0 1.5h-.6l-.55 7.14A1.5 1.5 0 0 1 10.35 13.5h-4.7a1.5 1.5 0 0 1-1.5-1.36L3.6 5H3a.75.75 0 0 1 0-1.5h2.75l.5-1Zm-.46 2.5.5 6.5h3.42l.5-6.5H5.79Z"/></svg>';
const ICON_CHEVRON = '<svg class="rule-group-chevron" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m4.2 6.1 3.8 3.8 3.8-3.8 1.05 1.05L8 12 3.15 7.15 4.2 6.1Z"/></svg>';
const ICON_WARNING = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.14 2.1a1 1 0 0 1 1.72 0l5.72 9.9a1 1 0 0 1-.86 1.5H2.28a1 1 0 0 1-.86-1.5l5.72-9.9ZM8 5a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 5Zm0 6a.88.88 0 1 0 0 1.75A.88.88 0 0 0 8 11Z"/></svg>';
const ICON_EYE_OPEN = '<path fill="currentColor" d="M8 2.6c3.65 0 6.25 2.7 7.2 4.14.5.76.5 1.76 0 2.52C14.25 10.7 11.65 13.4 8 13.4S1.75 10.7.8 9.26a2.28 2.28 0 0 1 0-2.52C1.75 5.3 4.35 2.6 8 2.6Zm0 1.5c-3.11 0-5.15 2.23-5.95 3.4a.78.78 0 0 0 0 .98C2.85 9.67 4.89 11.9 8 11.9s5.15-2.23 5.95-3.42a.78.78 0 0 0 0-.98C13.15 6.33 11.11 4.1 8 4.1Zm0 1.4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>';
const ICON_EYE_CLOSED = '<path fill="currentColor" d="m2.3 1.25 12.45 12.46-1.06 1.06-2.2-2.2A7.94 7.94 0 0 1 8 13.4c-3.65 0-6.25-2.7-7.2-4.14a2.28 2.28 0 0 1 0-2.52A10.4 10.4 0 0 1 3.2 4.1L1.24 2.31 2.3 1.25Zm1.99 3.94A8.8 8.8 0 0 0 2.05 7.5a.78.78 0 0 0 0 .98C2.85 9.67 4.89 11.9 8 11.9c.83 0 1.58-.16 2.25-.42l-1.2-1.2A2.5 2.5 0 0 1 5.72 6.95L4.29 5.19ZM8 2.6c3.65 0 6.25 2.7 7.2 4.14.5.76.5 1.76 0 2.52a10.7 10.7 0 0 1-1.53 1.85l-1.06-1.06a9.1 9.1 0 0 0 1.34-1.57.78.78 0 0 0 0-.98C13.15 6.33 11.11 4.1 8 4.1c-.36 0-.7.03-1.03.08L5.7 2.91A8.2 8.2 0 0 1 8 2.6Z"/>';

const MASKED_VALUE = '••••••••••••••••';

export function isSensitiveHeaderName(headerName) {
  return /(authorization|cookie|token|secret|api[-_]?key)/i.test(String(headerName || ''));
}

export function sortRulesForDisplay(rules, conflictingIds = new Set()) {
  return [...rules].sort((leftRule, rightRule) => {
    const conflictDifference = Number(conflictingIds.has(rightRule.id)) - Number(conflictingIds.has(leftRule.id));
    if (conflictDifference) {
      return conflictDifference;
    }

    return Number(rightRule.enabled) - Number(leftRule.enabled);
  });
}

export function sortDomainGroups(groups, conflictingIds, currentHostname) {
  return [...groups].sort((leftGroup, rightGroup) => {
    const leftHasConflict = leftGroup.rules.some((rule) => conflictingIds.has(rule.id));
    const rightHasConflict = rightGroup.rules.some((rule) => conflictingIds.has(rule.id));
    const conflictDifference = Number(rightHasConflict) - Number(leftHasConflict);
    if (conflictDifference) {
      return conflictDifference;
    }

    const currentSiteDifference = Number(rightGroup.domain === currentHostname)
      - Number(leftGroup.domain === currentHostname);
    if (currentSiteDifference) {
      return currentSiteDifference;
    }

    return leftGroup.domain.localeCompare(rightGroup.domain);
  });
}

export function createConflictMap(conflicts) {
  const conflictMap = new Map();

  conflicts.forEach(({ leftRule, rightRule }) => {
    conflictMap.set(leftRule.id, [...(conflictMap.get(leftRule.id) || []), rightRule]);
    conflictMap.set(rightRule.id, [...(conflictMap.get(rightRule.id) || []), leftRule]);
  });

  return conflictMap;
}

/**
 * Shared by the popup and the options page so a rule looks the same in both.
 * All display state is passed in — this module reads no page state of its own.
 */
export function renderRuleRow(rule, {
  conflictingRules = [],
  revealed = false,
  editing = false,
  editProfiles = null,
  needsAccess = false,
  profileName = ''
} = {}) {
  if (editing) {
    return renderRuleEditForm(rule, editProfiles);
  }

  const toggleTitle = `${rule.enabled ? 'Pause' : 'Resume'} ${rule.headerName} rule`;
  const isSensitive = isSensitiveHeaderName(rule.headerName);
  const displayValue = isSensitive && !revealed ? MASKED_VALUE : rule.headerValue;
  const hasConflict = conflictingRules.length > 0;
  const editTitle = 'Edit rule';

  return `
    <article class="domain-rule-row${rule.enabled ? '' : ' is-paused'}${hasConflict ? ' has-conflict' : ''}${needsAccess ? ' needs-access' : ''}">
      <div class="domain-rule-content">
        <div class="rule-row-head">
          <div class="rule-identification">
            <code class="rule-header-name">${escapeHtml(rule.headerName)}</code>
            ${profileName ? `<span class="rule-profile-chip">${escapeHtml(profileName)}</span>` : ''}
          </div>
          <div class="rule-row-controls">
            <button class="rule-enable-control" type="button" role="switch" aria-checked="${String(rule.enabled)}" data-rule-action="toggle" data-id="${rule.id}" aria-label="${toggleTitle}" title="${toggleTitle}">
              <span class="rule-switch-track" aria-hidden="true"><span class="rule-switch-thumb"></span></span>
              <span class="rule-enable-label">${rule.enabled ? 'On' : 'Paused'}</span>
            </button>
            <button class="rule-action-btn" type="button" data-rule-action="edit" data-id="${rule.id}" aria-label="${editTitle}: ${escapeHtml(rule.headerName)}" title="${editTitle}">${ICON_EDIT}</button>
            <button class="rule-action-btn danger" type="button" data-rule-action="delete" data-id="${rule.id}" aria-label="Delete ${escapeHtml(rule.headerName)} rule" title="Delete rule">${ICON_DELETE}</button>
          </div>
        </div>
        <div class="rule-value-row">
          <code class="rule-header-value${isSensitive && !revealed ? ' is-masked' : ''}">${escapeHtml(displayValue)}</code>
          ${isSensitive ? renderRevealButton(rule, revealed) : ''}
        </div>
        ${renderRuleScopeSummary(rule)}
        ${needsAccess ? renderAccessNotice(rule) : ''}
        ${hasConflict ? renderConflictNotice(conflictingRules) : ''}
      </div>
    </article>
  `;
}

/**
 * A rule whose host was never granted, or whose access was revoked. Chrome will
 * not apply it, so say that plainly instead of showing it as active.
 */
function renderAccessNotice(rule) {
  return `
    <div class="rule-access-notice" role="note">
      ${ICON_WARNING}
      <span>ReqKit doesn't have site access to <code>${escapeHtml(rule.domain)}</code>, so this rule isn't being applied.</span>
      <button class="rule-access-btn" type="button" data-rule-action="grant" data-id="${rule.id}">Grant</button>
    </div>
  `;
}

function renderRevealButton(rule, revealed) {
  const label = `${revealed ? 'Hide' : 'Reveal'} ${escapeHtml(rule.headerName)} value`;
  return `<button class="rule-value-btn" type="button" data-rule-action="reveal" data-id="${rule.id}" aria-label="${label}" title="${revealed ? 'Hide value' : 'Reveal value'}"><svg viewBox="0 0 16 16" aria-hidden="true">${revealed ? ICON_EYE_CLOSED : ICON_EYE_OPEN}</svg></button>`;
}

export function renderConflictNotice(conflictingRules) {
  const detail = conflictingRules.length === 1
    ? 'Request scope overlaps another active rule with a different value.'
    : `Request scope overlaps ${conflictingRules.length} active rules with different values.`;

  return `
    <div class="rule-conflict-notice" role="note">
      ${ICON_WARNING}
      <span><strong>Conflict.</strong> ${escapeHtml(detail)}</span>
    </div>
  `;
}

function renderRuleScopeSummary(rule) {
  const parts = [];
  if (rule.pathPrefix) {
    parts.push(`Path <code>${escapeHtml(rule.pathPrefix)}</code> and subpaths`);
  }
  if (rule.resourceType === 'xmlhttprequest') {
    parts.push('Fetch/XHR only');
  }
  if (!parts.length) {
    return '';
  }

  return `<div class="rule-scope-summary" aria-label="Request scope">${parts.map((part) => `<span>${part}</span>`).join('<span aria-hidden="true">·</span>')}</div>`;
}

export function renderRuleEditForm(rule, profiles = null) {
  const showProfileField = Array.isArray(profiles) && profiles.length > 1;
  const selectedResourceType = rule.resourceType === 'xmlhttprequest' ? 'xmlhttprequest' : 'all';

  return `
    <div class="domain-rule-row">
      <form class="rule-edit-form" data-id="${rule.id}">
        <div class="rule-edit-grid">
          <div class="rule-edit-field rule-edit-field-host">
            <label for="editDomain-${rule.id}">Exact HTTPS host</label>
            <input id="editDomain-${rule.id}" type="text" value="${escapeHtml(rule.domain)}" autocapitalize="off" autocorrect="off" spellcheck="false">
          </div>
          <div class="rule-edit-field rule-edit-field-name">
            <label for="editHeaderName-${rule.id}">Header name</label>
            <input id="editHeaderName-${rule.id}" type="text" value="${escapeHtml(rule.headerName)}" autocapitalize="off" autocorrect="off" spellcheck="false">
          </div>
          <div class="rule-edit-field rule-edit-field-value">
            <label for="editHeaderValue-${rule.id}">Header value</label>
            <input id="editHeaderValue-${rule.id}" type="text" value="${escapeHtml(rule.headerValue)}" autocapitalize="off" autocorrect="off" spellcheck="false">
          </div>
          <div class="rule-edit-field rule-edit-field-path">
            <label for="editPathPrefix-${rule.id}">Path prefix (optional)</label>
            <input id="editPathPrefix-${rule.id}" type="text" value="${escapeHtml(rule.pathPrefix || '')}" placeholder="/api/v1" maxlength="512" autocapitalize="off" autocorrect="off" spellcheck="false">
          </div>
          <div class="rule-edit-field rule-edit-field-resource-type">
            <label for="editResourceType-${rule.id}">Request type</label>
            <select id="editResourceType-${rule.id}">
              <option value="all"${selectedResourceType === 'all' ? ' selected' : ''}>All requests</option>
              <option value="xmlhttprequest"${selectedResourceType === 'xmlhttprequest' ? ' selected' : ''}>API calls (fetch/XHR)</option>
            </select>
          </div>
          ${showProfileField ? renderProfileField(rule, profiles) : ''}
        </div>
        <p class="helper-text disclosure-text rule-edit-disclosure">Stored in this Chrome profile and sent only to the exact HTTPS host you approve. Use only authorized systems.</p>
        <div id="ruleEditStatus-${rule.id}" class="status-msg rule-edit-status" aria-live="polite"></div>
        <div class="action-row rule-edit-actions">
          <button class="primary-btn save-edit-rule-btn" type="submit">Save changes</button>
          <button class="secondary-btn" type="button" data-rule-action="cancel-edit" data-id="${rule.id}">Cancel</button>
        </div>
      </form>
    </div>
  `;
}

function renderProfileField(rule, profiles) {
  const currentProfileId = rule.profileId || 'default';
  const options = profiles.map((profile) => (
    `<option value="${escapeHtml(profile.id)}"${profile.id === currentProfileId ? ' selected' : ''}>${escapeHtml(profile.name)}</option>`
  )).join('');

  return `
    <div class="rule-edit-field rule-edit-field-profile">
      <label for="editProfile-${rule.id}">Profile</label>
      <select id="editProfile-${rule.id}">${options}</select>
    </div>
  `;
}

export function renderDomainGroup(domain, domainRules, {
  index,
  conflictMap = new Map(),
  collapsed = false,
  currentHostname = '',
  editingId = null,
  revealedRuleIds = new Set(),
  editProfiles = null,
  managerView = false,
  describeRule = () => ({})
} = {}) {
  const conflictingIds = new Set(conflictMap.keys());
  const sortedRules = sortRulesForDisplay(domainRules, conflictingIds);
  const hasEditingRule = domainRules.some((rule) => rule.id === editingId);
  const isCollapsed = collapsed && !hasEditingRule;
  const activeCount = domainRules.filter((rule) => rule.enabled).length;
  const pausedCount = domainRules.length - activeCount;
  const conflictCount = domainRules.reduce((count, rule) => (
    count + (conflictMap.get(rule.id)?.length || 0)
  ), 0) / 2;
  const groupId = `domainRuleGroup-${index}`;
  const summary = managerView
    ? `${domainRules.length} ${domainRules.length === 1 ? 'rule' : 'rules'} · ${activeCount} on`
    : [
      activeCount ? `${activeCount} active` : '',
      pausedCount ? `${pausedCount} paused` : ''
    ].filter(Boolean).join(' · ');

  return `
    <section class="rule-group${conflictCount ? ' has-conflict' : ''}">
      <button class="rule-group-toggle" type="button" data-rule-action="toggle-domain" data-domain="${escapeHtml(domain)}" aria-expanded="${String(!isCollapsed)}" aria-controls="${groupId}">
        <span class="rule-group-heading">
          <span class="rule-domain">${escapeHtml(domain)}</span>
          ${domain === currentHostname ? '<span class="current-site-badge">Current site</span>' : ''}
        </span>
        <span class="rule-group-meta">
          <span class="rule-group-summary">${summary}</span>
          ${conflictCount ? `<span class="rule-group-conflict">${conflictCount} ${conflictCount === 1 ? 'conflict' : 'conflicts'}</span>` : ''}
          ${ICON_CHEVRON}
        </span>
      </button>
      <div id="${groupId}" class="domain-rule-list"${isCollapsed ? ' hidden' : ''}>
        ${sortedRules.map((rule) => renderRuleRow(rule, {
          conflictingRules: conflictMap.get(rule.id) || [],
          revealed: revealedRuleIds.has(rule.id),
          editing: rule.id === editingId,
          editProfiles,
          ...describeRule(rule)
        })).join('')}
      </div>
    </section>
  `;
}
