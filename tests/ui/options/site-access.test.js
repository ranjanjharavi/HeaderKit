import assert from 'node:assert/strict';
import test from 'node:test';
import { createSiteAccessActions } from '../../../extension/options/site-access/actions.js';
import { bindSiteAccessEvents } from '../../../extension/options/site-access/controller.js';
import * as view from '../../../extension/options/site-access/view.js';
import { state } from '../../../extension/options/state.js';
import { createBackupFixture } from '../../helpers/backup.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

function setupActions(overrides = {}) {
  const fixture = createBackupFixture();
  const snapshot = {
    profiles: fixture.profiles,
    rules: fixture.rules,
    grantedOrigins: new Set(['https://api.example.com/*', 'https://staging.example.com/*'])
  };
  const calls = [];
  const errors = [];
  const actions = createSiteAccessActions({
    getState: () => snapshot,
    setGrantedOrigins: (origins) => {
      snapshot.grantedOrigins = origins;
    },
    refreshState:
      overrides.refreshState ??
      (async () => {
        calls.push('refresh');
      }),
    removePermission:
      overrides.removePermission ??
      (async (origin) => {
        calls.push(['remove', origin]);
        return true;
      }),
    onError: (...args) => errors.push(args)
  });
  return { actions, snapshot, calls, errors };
}

function setupView(t, origins = ['https://api.example.com/*', 'https://*/*', 'https://staging.example.com/*']) {
  const harness = createUiHarness(t);
  t.mock.method(console, 'error', () => {});
  const fixture = createBackupFixture();
  Object.assign(state, { profiles: fixture.profiles, rules: fixture.rules, grantedOrigins: new Set(origins) });
  const list = harness.element('siteAccessList');
  const search = harness.element('siteAccessSearch');
  search.value = '';
  search.closest = () => harness.element('search-container');
  const rows = origins.map((origin) => {
    const row = harness.element(`row-${origin}`);
    row.dataset.siteAccessOrigin = origin;
    const control = harness.element(`revoke-${origin}`);
    control.dataset = { siteAccessAction: 'revoke', origin };
    control.closest = (selector) => (selector === '.site-access-row' ? row : control);
    return { row, control };
  });
  const currentRows = () => rows.filter(({ row }) => state.grantedOrigins?.has(row.dataset.siteAccessOrigin));
  const expanded = [];
  list.querySelectorAll = (selector) =>
    selector === '.site-access-row' ? currentRows().map(({ row }) => row) : expanded;
  list.querySelector = (selector) =>
    selector === '.site-access-filter-empty' ? harness.element('filter-empty') : harness.element('retry');
  list.contains = (node) => rows.some(({ control }) => control === node) || node === harness.element('retry');
  list.scrollTop = 0;
  let html = '';
  Object.defineProperty(list, 'innerHTML', {
    get: () => html,
    set(value) {
      html = value;
      // Simulate replacement losing scroll and focus; full DOM behavior is also
      // exercised by the existing browser fixtures in the Chrome smoke checks.
      list.scrollTop = 0;
      document.activeElement = harness.element('body');
    }
  });
  document.querySelectorAll = () => currentRows().map(({ control }) => control);
  document.querySelector = () => harness.element('retry');
  const calls = [];
  const permissionListeners = { added: [], removed: [] };
  chrome.permissions = {
    onAdded: { addListener: (listener) => permissionListeners.added.push(listener) },
    onRemoved: { addListener: (listener) => permissionListeners.removed.push(listener) },
    remove: ({ origins }, callback) => {
      calls.push(['remove', ...origins]);
      callback(true);
    }
  };
  return { ...harness, list, search, rows, expanded, calls, permissionListeners };
}

async function flush() {
  await new Promise(setImmediate);
}

test('revocation preparation uses actual grants and counts covered saved rules across profiles', () => {
  const { actions, snapshot, calls } = setupActions();
  assert.deepEqual(actions.prepareRevocation('https://api.example.com/*'), {
    origin: 'https://api.example.com/*',
    ruleCount: 2
  });
  assert.equal(actions.prepareRevocation('https://unknown.example.com/*'), null);
  snapshot.grantedOrigins = new Set(['https://*/*']);
  assert.equal(actions.prepareRevocation('https://*/*').ruleCount, 3);
  snapshot.grantedOrigins = null;
  assert.equal(actions.prepareRevocation('https://api.example.com/*'), null);
  assert.deepEqual(calls, []);
});

test('successful revocation refreshes grants but never mutates saved rules or unrelated grants', async () => {
  const harness = setupActions();
  const before = structuredClone(harness.snapshot.rules);
  await harness.actions.revoke('https://api.example.com/*');
  assert.deepEqual(harness.calls, [['remove', 'https://api.example.com/*'], 'refresh']);
  assert.deepEqual([...harness.snapshot.grantedOrigins], ['https://staging.example.com/*']);
  assert.deepEqual(harness.snapshot.rules, before);
});

for (const failure of ['denied', 'rejected']) {
  test(`a ${failure} revocation leaves the cached grants and rules unchanged`, async () => {
    const error = new Error('Permission API failed');
    const harness = setupActions({
      removePermission: async () => {
        if (failure === 'rejected') throw error;
        return false;
      }
    });
    const before = structuredClone(harness.snapshot);
    await assert.rejects(
      harness.actions.revoke('https://api.example.com/*'),
      failure === 'denied' ? /Chrome did not remove/ : (received) => received === error
    );
    assert.deepEqual(harness.snapshot, before);
    assert.deepEqual(harness.calls, []);
  });
}

for (const failure of ['unavailable grants', 'refresh rejection']) {
  test(`revocation retains a truthful fallback after ${failure}`, async () => {
    const error = new Error('Refresh unavailable');
    const harness = setupActions({
      refreshState: async () => {
        harness.snapshot.grantedOrigins = null;
        if (failure === 'refresh rejection') throw error;
      }
    });
    const rulesBefore = structuredClone(harness.snapshot.rules);
    await harness.actions.revoke('https://api.example.com/*');
    assert.deepEqual([...harness.snapshot.grantedOrigins], ['https://staging.example.com/*']);
    assert.deepEqual(harness.snapshot.rules, rulesBefore);
    assert.equal(harness.errors.length, failure === 'refresh rejection' ? 1 : 0);
  });
}

test('revocation preserves grants discovered by a concurrent refresh', async () => {
  const harness = setupActions({
    refreshState: async () => {
      harness.snapshot.grantedOrigins = new Set(['https://api.example.com/*', 'https://new.example.com/*']);
    }
  });
  await harness.actions.revoke('https://api.example.com/*');
  assert.deepEqual([...harness.snapshot.grantedOrigins], ['https://new.example.com/*']);
});

test('feature refreshes serialize, recover from rejection, and do not share queues between instances', async () => {
  let release;
  let starts = 0;
  const first = setupActions({
    refreshState: async () => {
      if (++starts === 1)
        await new Promise((resolve) => {
          release = resolve;
        });
      else if (starts === 2) throw new Error('Second failed');
    }
  });
  const second = setupActions();
  const pending = first.actions.refresh();
  const rejected = assert.rejects(first.actions.refresh(), /Second failed/);
  await flush();
  assert.equal(starts, 1);
  await second.actions.refresh();
  assert.deepEqual(second.calls, ['refresh']);
  release();
  await pending;
  await rejected;
  await first.actions.refresh();
  assert.equal(starts, 3);
});

test('grant rendering prioritizes broad coverage, escapes names, and never reads credential values', (t) => {
  const harness = setupView(t);
  state.profiles[1].name = '<QA & review>';
  Object.defineProperty(state.rules[0], 'headerValue', {
    get() {
      throw new Error('Grant views must not read header values');
    }
  });
  view.openSiteAccessDialog();
  view.renderSiteAccessOverview();
  const html = harness.list.innerHTML;
  assert.ok(
    html.indexOf('data-site-access-origin="https://*/*"') <
      html.indexOf('data-site-access-origin="https://api.example.com/*"')
  );
  assert.match(html, /Broad site access/);
  assert.match(html, /Can cover rules for any HTTPS host/);
  assert.match(html, /Host-specific site access/);
  assert.match(html, /&lt;QA &amp; review&gt;/);
  assert.match(html, /Authorization/);
  assert.match(html, /\/api\/v1 · Fetch\/XHR/);
  assert.match(html, /Paused/);
  assert.doesNotMatch(html, /Bearer|backup-test-secret/);
  assert.doesNotMatch(html, /No site permissions|Loading site permissions|Broad grant|Host grant/);
  assert.match(html, /<summary data-site-access-action="rules" data-origin="https:\/\/\*\/\*">3 saved rules/);
});

test('rendering preserves expanded details, list scroll position, and the focused grant control', (t) => {
  const harness = setupView(t);
  view.openSiteAccessDialog();
  const { row, control } = harness.rows[0];
  harness.expanded.push({ closest: () => row });
  control.focus();
  harness.list.scrollTop = 42;
  view.renderSiteAccessOverview();
  assert.match(harness.list.innerHTML, /<details class="site-access-rules" open>/);
  assert.equal(harness.list.scrollTop, 42);
  assert.equal(document.activeElement, control);
});

test('search covers broad grants, reports no matches, and keeps the query across refresh rendering', (t) => {
  const harness = setupView(t);
  view.openSiteAccessDialog();
  harness.search.value = 'api.example.com';
  view.renderSiteAccessOverview();
  assert.equal(harness.rows.filter(({ row }) => !row.hidden).length, 2);
  assert.match(harness.element('siteAccessSummary').textContent, /2 of 3 grants match or cover/);
  view.renderSiteAccessOverview();
  assert.equal(harness.search.value, 'api.example.com');
  harness.search.value = 'no matching words';
  view.filterSiteAccessGrants();
  assert.ok(harness.rows.every(({ row }) => row.hidden));
  assert.equal(harness.element('filter-empty').hidden, false);
});

test('closed, empty, loading, and failed-load states keep dialog controls consistent', (t) => {
  const harness = setupView(t);
  view.renderSiteAccessOverview();
  assert.equal(harness.list.innerHTML, '');
  view.openSiteAccessDialog();
  view.renderLoading();
  assert.equal(harness.list.getAttribute('aria-busy'), 'true');
  assert.match(harness.list.innerHTML, /Loading site access grants/);
  assert.equal(harness.search.disabled, true);
  harness.search.focus();
  state.grantedOrigins = null;
  view.renderSiteAccessOverview();
  assert.match(harness.list.innerHTML, /Could not read site access/);
  assert.equal(harness.list.getAttribute('aria-busy'), 'false');
  assert.equal(document.activeElement, harness.element('retry'));
  state.grantedOrigins = new Set();
  view.renderSiteAccessOverview();
  assert.equal(harness.element('siteAccessSummary').textContent, 'No site access grants are active.');
  assert.equal(harness.element('search-container').hidden, true);
  assert.equal(harness.search.value, '');
  view.closeSiteAccessDialog();
  assert.equal(view.isSiteAccessDialogOpen(), false);
});

test('confirmation copy explains broad and host-specific grants without promising to delete rules', () => {
  const broad = view.getRevokeConfirmation({ origin: 'https://*.example.com/*', ruleCount: 2 });
  assert.match(broad.message, /broad site access grant.*covers multiple hosts/);
  assert.match(broad.message, /2 saved rules.*rules stay saved/);
  const host = view.getRevokeConfirmation({ origin: 'https://api.example.com/*', ruleCount: 1 });
  assert.match(host.message, /1 saved rule.*rules will stay saved/);
  assert.match(
    view.getRevokeConfirmation({ origin: 'https://unused.example.com/*', ruleCount: 0 }).message,
    /No saved rules/
  );
});

test('controller revocation waits for confirmation, reflects busy state during redraw, and retains rules', async (t) => {
  const harness = setupView(t);
  bindSiteAccessEvents({ onRefreshState: async () => {}, onRenderRules: () => harness.calls.push('render-rules') });
  await harness.element('siteAccessBtn').dispatch('click');
  const { control } = harness.rows[0];
  await harness.list.dispatch('click', { target: control });
  assert.deepEqual(harness.calls, []);
  await harness.element('confirmationCancelBtn').dispatch('click');
  await flush();
  assert.equal(state.grantedOrigins.has(control.dataset.origin), true);
  let release;
  chrome.permissions.remove = (_details, callback) => {
    release = callback;
  };
  const before = structuredClone(state.rules);
  await harness.list.dispatch('click', { target: control });
  await harness.element('confirmationConfirmBtn').dispatch('click');
  assert.equal(control.disabled, true);
  view.renderSiteAccessOverview();
  assert.match(harness.list.innerHTML, /aria-label="Revoke site access for api.example.com" disabled>Revoking…/);
  release(true);
  await flush();
  assert.equal(state.grantedOrigins.has(control.dataset.origin), false);
  assert.deepEqual(state.rules, before);
  assert.deepEqual(harness.calls, ['render-rules']);
  assert.match(harness.element('siteAccessStatus').textContent, /Saved rules were kept/);
  assert.doesNotMatch(harness.list.innerHTML, /Revoking…/);
  assert.equal(document.activeElement, harness.rows[1].control);
});

test('controller revocation failure restores its presentation without removing grants or saved rules', async (t) => {
  const harness = setupView(t);
  bindSiteAccessEvents({
    onRefreshState: async () => {},
    onRenderRules: () => assert.fail('Failed revocations must not publish rule changes.')
  });
  await harness.element('siteAccessBtn').dispatch('click');
  const before = structuredClone(state.rules);
  const { control } = harness.rows[0];
  chrome.permissions.remove = (_details, callback) => callback(false);
  await harness.list.dispatch('click', { target: control });
  await harness.element('confirmationConfirmBtn').dispatch('click');
  await flush();
  assert.equal(state.grantedOrigins.has(control.dataset.origin), true);
  assert.deepEqual(state.rules, before);
  assert.equal(harness.element('siteAccessStatus').textContent, 'Chrome did not remove this site access grant.');
  assert.doesNotMatch(harness.list.innerHTML, /Revoking…/);
  assert.equal(document.activeElement, control);
});

test('permission refresh errors expose retry only in an open dialog and failed retries keep focus usable', async (t) => {
  const harness = setupView(t);
  let fails = false;
  bindSiteAccessEvents({
    onRefreshState: async () => {
      if (fails) throw new Error('Read failed');
    },
    onRenderRules() {}
  });
  await harness.element('siteAccessBtn').dispatch('click');
  fails = true;
  harness.search.focus();
  harness.permissionListeners.added[0]();
  await flush();
  assert.match(harness.list.innerHTML, /Could not read site access/);
  const retry = harness.element('retry');
  retry.dataset.siteAccessAction = 'retry';
  await harness.list.dispatch('click', { target: retry });
  await flush();
  assert.equal(document.activeElement, retry);
  view.closeSiteAccessDialog();
  const before = harness.list.innerHTML;
  harness.permissionListeners.removed[0]();
  await flush();
  assert.equal(harness.list.innerHTML, before);
});

test('all-URL and wildcard grants retain their labels and coverage descriptions', (t) => {
  const harness = setupView(t, ['<all_urls>', 'https://*.example.com/*', 'https://unused.example.net/*']);
  view.openSiteAccessDialog();
  view.renderSiteAccessOverview();
  assert.match(harness.list.innerHTML, /All websites/);
  assert.match(harness.list.innerHTML, /Can cover rules for example.com and its subdomains/);
  assert.match(harness.list.innerHTML, /No saved rules use this grant/);
});

test('controller retry recovers a failed refresh and permission events refresh even while closed', async (t) => {
  const harness = setupView(t);
  let fails = true;
  let refreshes = 0;
  bindSiteAccessEvents({
    onRefreshState: async () => {
      refreshes++;
      if (fails) throw new Error('Load failed');
    },
    onRenderRules: () => {}
  });
  await harness.element('siteAccessBtn').dispatch('click');
  assert.match(harness.list.innerHTML, /Try again/);
  fails = false;
  const retry = harness.element('retry');
  retry.dataset.siteAccessAction = 'retry';
  await harness.list.dispatch('click', { target: retry });
  await flush();
  assert.match(harness.list.innerHTML, /site-access-row/);
  assert.equal(document.activeElement, harness.search);
  view.closeSiteAccessDialog();
  harness.permissionListeners.removed[0]();
  await flush();
  assert.equal(refreshes, 3);
});
