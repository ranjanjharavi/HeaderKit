import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { removeOriginPermission } from '../../shared/runtime/chrome-api.js';
import { getProfileName } from '../../shared/domain/profiles.js';
import {
  filterOriginGrants,
  getRulesForOriginGrant,
  isBroadOrigin
} from '../../shared/domain/site-access.js';
import { createSerialQueue } from '../../shared/runtime/serial-queue.js';
import { escapeHtml, showStatus } from '../../shared/ui/ui.js';
import { state } from '../state.js';

const enqueueStateRefresh = createSerialQueue();
const revokingOrigins = new Set();
let refreshState = async () => {};
let renderRules = () => {};

export function bindSiteAccessEvents({ onRefreshState, onRenderRules }) {
  refreshState = onRefreshState;
  renderRules = onRenderRules;

  document.getElementById('siteAccessBtn').addEventListener('click', openSiteAccessDialog);
  document.getElementById('closeSiteAccessBtn').addEventListener('click', closeSiteAccessDialog);
  document.getElementById('doneSiteAccessBtn').addEventListener('click', closeSiteAccessDialog);
  document.getElementById('siteAccessDialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closeSiteAccessDialog();
    }
  });
  document.getElementById('siteAccessList').addEventListener('click', handleSiteAccessListClick);
  document.getElementById('siteAccessSearch').addEventListener('input', filterSiteAccessGrants);

  chrome.permissions.onAdded.addListener(refreshAfterPermissionChange);
  chrome.permissions.onRemoved.addListener(refreshAfterPermissionChange);
}

export function renderSiteAccessOverview() {
  const dialog = document.getElementById('siteAccessDialog');
  if (!dialog?.open) {
    return;
  }

  const list = document.getElementById('siteAccessList');
  const focusedControl = list.contains(document.activeElement)
    ? {
      action: document.activeElement.dataset.siteAccessAction,
      origin: document.activeElement.dataset.origin
    }
    : null;
  const expandedOrigins = new Set([...list.querySelectorAll('.site-access-rules[open]')]
    .map((details) => details.closest('.site-access-row').dataset.siteAccessOrigin));
  const scrollTop = list.scrollTop;
  if (!(state.grantedOrigins instanceof Set)) {
    renderLoadError();
    return;
  }

  const search = document.getElementById('siteAccessSearch');
  const origins = [...state.grantedOrigins].sort((left, right) => (
    Number(isBroadOrigin(right)) - Number(isBroadOrigin(left)) || left.localeCompare(right)
  ));
  list.setAttribute('aria-busy', 'false');

  if (!origins.length) {
    search.value = '';
    search.disabled = true;
    search.closest('.site-access-search').hidden = true;
    document.getElementById('siteAccessSummary').textContent = 'No site access grants are active.';
    list.innerHTML = `
      <div class="site-access-empty">
        <strong>No sites to review</strong>
        <p>HeaderKit asks for site access only when you create or resume a rule.</p>
      </div>
    `;
    restoreListFocus(focusedControl);
    return;
  }

  search.disabled = false;
  search.closest('.site-access-search').hidden = false;
  list.innerHTML = `${origins.map((origin) => renderOriginGrant(origin, expandedOrigins)).join('')}
    <div class="site-access-empty site-access-filter-empty" hidden>
      <strong>No matching grants</strong>
      <p>Try another host or grant pattern.</p>
    </div>`;
  filterSiteAccessGrants();
  list.scrollTop = scrollTop;
  restoreListFocus(focusedControl);
}

async function openSiteAccessDialog() {
  const dialog = document.getElementById('siteAccessDialog');
  const retrying = dialog.open;
  if (!retrying) {
    dialog.showModal();
  }

  renderLoading();
  clearSiteAccessStatus();
  try {
    await refreshCurrentState();
    renderSiteAccessOverview();
    if (retrying && dialog.open) {
      const search = document.getElementById('siteAccessSearch');
      (search.disabled ? document.getElementById('closeSiteAccessBtn') : search).focus({ preventScroll: true });
    }
  } catch (error) {
    console.error('Could not load granted site access.', error);
    renderLoadError();
    if (retrying && dialog.open) {
      document.querySelector('#siteAccessList [data-site-access-action="retry"]')?.focus({ preventScroll: true });
    }
  }
}

function closeSiteAccessDialog() {
  const dialog = document.getElementById('siteAccessDialog');
  if (dialog.open) {
    dialog.close();
  }
}

function handleSiteAccessListClick(event) {
  const button = event.target.closest('[data-site-access-action]');
  if (!button) {
    return;
  }

  if (button.dataset.siteAccessAction === 'retry') {
    openSiteAccessDialog();
  } else if (button.dataset.siteAccessAction === 'revoke') {
    revokeOrigin(button.dataset.origin, button);
  }
}

async function revokeOrigin(origin, button) {
  if (!(state.grantedOrigins instanceof Set) || !state.grantedOrigins.has(origin)) {
    return;
  }

  const rules = getRulesForOriginGrant(state.rules, origin);
  const confirmed = await confirmDestructiveAction({
    title: `Revoke site access for ${getOriginLabel(origin)}?`,
    message: getRevokeMessage(origin, rules.length),
    confirmLabel: 'Revoke access'
  });
  if (!confirmed) {
    return;
  }

  const knownOrigins = new Set(state.grantedOrigins);
  knownOrigins.delete(origin);
  button.disabled = true;
  button.textContent = 'Revoking…';
  revokingOrigins.add(origin);

  try {
    const removed = await removeOriginPermission(origin);
    if (!removed) {
      throw new Error('Chrome did not remove this site access grant.');
    }

    try {
      await refreshCurrentState();
    } catch (error) {
      console.error('Could not refresh rules after revoking site access.', error);
    }

    if (state.grantedOrigins instanceof Set) {
      state.grantedOrigins.delete(origin);
    } else {
      state.grantedOrigins = knownOrigins;
    }
    renderRules();
    showStatus(
      'siteAccessStatus',
      `Site access grant revoked for ${getOriginLabel(origin)}. Saved rules were kept.`,
      'success'
    );
  } catch (error) {
    console.error('Could not revoke site access.', error);
    showStatus('siteAccessStatus', error.message || 'Could not revoke this site access grant.', 'error');
  } finally {
    revokingOrigins.delete(origin);
    renderSiteAccessOverview();
    focusAfterRevocation(origin);
  }
}

function filterSiteAccessGrants() {
  const search = document.getElementById('siteAccessSearch');
  const list = document.getElementById('siteAccessList');
  const rows = [...list.querySelectorAll('.site-access-row')];
  const origins = rows.map((row) => row.dataset.siteAccessOrigin);
  const matchingOrigins = new Set(filterOriginGrants(origins, search.value));
  const matchCount = rows.reduce((count, row) => {
    const matches = matchingOrigins.has(row.dataset.siteAccessOrigin);
    row.hidden = !matches;
    return count + Number(matches);
  }, 0);
  const query = search.value.trim();
  const emptyState = list.querySelector('.site-access-filter-empty');
  emptyState.hidden = !query || matchCount > 0;

  document.getElementById('siteAccessSummary').textContent = query
    ? matchCount
      ? `${matchCount} of ${rows.length} grants match or cover “${query}”.`
      : `No grants match or cover “${query}”.`
    : `${rows.length} site access ${rows.length === 1 ? 'grant is' : 'grants are'} active.`;
}

function restoreListFocus(focusedControl) {
  if (!focusedControl) {
    return;
  }

  const controls = [...document.querySelectorAll('#siteAccessList [data-site-access-action]')]
    .filter((control) => !control.closest('.site-access-row')?.hidden);
  const target = controls.find((control) => (
    control.dataset.siteAccessAction === focusedControl.action
      && control.dataset.origin === focusedControl.origin
  )) || controls[0] || (document.getElementById('siteAccessSearch').disabled
    ? document.getElementById('closeSiteAccessBtn')
    : document.getElementById('siteAccessSearch'));
  target.focus({ preventScroll: true });
}

function focusAfterRevocation(origin) {
  if (!document.getElementById('siteAccessDialog').open) {
    return;
  }

  const controls = [...document.querySelectorAll('#siteAccessList [data-site-access-action="revoke"]')]
    .filter((control) => !control.closest('.site-access-row')?.hidden);
  const target = controls.find((control) => control.dataset.origin === origin)
    || controls[0]
    || (document.getElementById('siteAccessSearch').disabled
      ? document.getElementById('closeSiteAccessBtn')
      : document.getElementById('siteAccessSearch'));
  target.focus({ preventScroll: true });
}

function refreshAfterPermissionChange() {
  refreshCurrentState()
    .then(() => renderSiteAccessOverview())
    .catch((error) => {
      console.error('Could not refresh site access grants.', error);
      if (document.getElementById('siteAccessDialog').open) {
        renderLoadError();
      }
    });
}

function refreshCurrentState() {
  return enqueueStateRefresh(() => refreshState());
}

function renderLoading() {
  document.getElementById('siteAccessSummary').textContent = 'Checking site access…';
  const search = document.getElementById('siteAccessSearch');
  search.disabled = true;
  search.closest('.site-access-search').hidden = true;
  const list = document.getElementById('siteAccessList');
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = '<p class="site-access-loading">Loading site access grants…</p>';
}

function clearSiteAccessStatus() {
  const status = document.getElementById('siteAccessStatus');
  status.textContent = '';
  status.classList.remove('visible', 'success', 'error');
  globalThis.clearTimeout(status._statusTimer);
}

function renderLoadError() {
  document.getElementById('siteAccessSummary').textContent = 'Site access is unavailable.';
  const search = document.getElementById('siteAccessSearch');
  const list = document.getElementById('siteAccessList');
  const focusRetry = list.contains(document.activeElement) || document.activeElement === search;
  search.disabled = true;
  search.closest('.site-access-search').hidden = true;
  list.setAttribute('aria-busy', 'false');
  list.innerHTML = `
    <div class="site-access-empty">
      <strong>Could not read site access</strong>
      <p>Try again to reload the site access list.</p>
      <button class="secondary-btn" type="button" data-site-access-action="retry">Try again</button>
    </div>
  `;
  if (focusRetry) {
    list.querySelector('[data-site-access-action="retry"]').focus({ preventScroll: true });
  }
}

function renderOriginGrant(origin, expandedOrigins) {
  const isBroad = isBroadOrigin(origin);
  const rules = getRulesForOriginGrant(state.rules, origin);
  const revokeLabel = `Revoke site access for ${getOriginLabel(origin)}`;
  const revokeText = revokingOrigins.has(origin) ? 'Revoking…' : 'Revoke access';
  const breadthNote = isBroad
    ? `<p class="site-access-breadth">${escapeHtml(getBroadAccessDescription(origin))}</p>`
    : '';
  const ruleDetails = rules.length
    ? `<details class="site-access-rules"${expandedOrigins.has(origin) ? ' open' : ''}>
        <summary data-site-access-action="rules" data-origin="${escapeHtml(origin)}">${rules.length} saved ${rules.length === 1 ? 'rule' : 'rules'}</summary>
        <ul class="site-access-rule-list">${rules.map(renderCoveredRule).join('')}</ul>
      </details>`
    : '<p class="site-access-no-rules">No saved rules use this grant.</p>';

  return `
    <article class="site-access-row${isBroad ? ' is-broad' : ''}" data-site-access-origin="${escapeHtml(origin)}">
      <div class="site-access-row-main">
        <div class="site-access-row-heading">
          <div class="site-access-grant-name">
            <h3>${escapeHtml(getOriginLabel(origin))}</h3>
            <code>${escapeHtml(origin)}</code>
          </div>
          <span class="site-access-kind${isBroad ? ' is-broad' : ''}">${isBroad ? 'Broad site access' : 'Host-specific site access'}</span>
        </div>
        ${breadthNote}
        ${ruleDetails}
      </div>
      <button class="secondary-btn site-access-revoke-btn" type="button" data-site-access-action="revoke" data-origin="${escapeHtml(origin)}" aria-label="${escapeHtml(revokeLabel)}"${revokingOrigins.has(origin) ? ' disabled' : ''}>${revokeText}</button>
    </article>
  `;
}

function renderCoveredRule(rule) {
  const requestScope = [
    rule.pathPrefix || 'All paths',
    rule.resourceType === 'xmlhttprequest' ? 'Fetch/XHR' : 'All requests'
  ].join(' · ');
  const ruleState = rule.enabled ? 'On' : 'Paused';

  return `
    <li>
      <div class="site-access-rule-heading">
        <strong>${escapeHtml(rule.headerName)}</strong>
        <span>${escapeHtml(rule.domain)}</span>
      </div>
      <p>${escapeHtml(getProfileName(state.profiles, rule.profileId))} · ${ruleState} · ${escapeHtml(requestScope)}</p>
    </li>
  `;
}

function getOriginLabel(origin) {
  if (origin === '<all_urls>') {
    return 'All websites';
  }
  if (origin === 'https://*/*') {
    return 'All HTTPS sites';
  }

  const match = /^https:\/\/(\*\.)?([^/*]+)\/\*$/.exec(origin);
  return match ? `${match[1] || ''}${match[2]}` : origin;
}

function getBroadAccessDescription(origin) {
  if (origin === '<all_urls>' || origin === 'https://*/*') {
    return 'Can cover rules for any HTTPS host.';
  }

  const match = /^https:\/\/\*\.([^/*]+)\/\*$/.exec(origin);
  return match
    ? `Can cover rules for ${match[1]} and its subdomains.`
    : 'Can cover rules on multiple hosts.';
}

function getRevokeMessage(origin, ruleCount) {
  const label = getOriginLabel(origin);
  const savedRules = `${ruleCount} saved ${ruleCount === 1 ? 'rule' : 'rules'}`;
  if (isBroadOrigin(origin)) {
    const coverage = ruleCount
      ? ` It covers ${savedRules}. The rules stay saved. Enabled rules on hosts no other grant covers will stop applying.`
      : '';
    return `This broad site access grant covers multiple hosts. Revoking it removes the grant.${coverage}`;
  }
  if (!ruleCount) {
    return `No saved rules are covered by this grant. Revoking it removes this grant; broader site access may still cover ${label}.`;
  }

  return `This grant covers ${savedRules}. The rules will stay saved. Enabled rules won't apply unless another grant still covers ${label}.`;
}
