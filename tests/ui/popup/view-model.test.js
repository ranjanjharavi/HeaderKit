import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { createDefaultProfiles } from '../../../extension/shared/domain/profiles.js';
import {
  getActivationDisplay,
  getManagerLinkLabel,
  getManagerPath,
  getPopupRuleViewModel
} from '../../../extension/popup/view-model.js';
import { createBackupFixture } from '../../helpers/backup.js';

const now = 2_000_000;
const profiles = [
  ...createDefaultProfiles(),
  { id: 'staging', name: 'Staging', createdAt: 1, defaultDurationMs: null }
];

function ruleSnapshot() {
  const fixture = createBackupFixture();
  fixture.rules.push({
    ...fixture.rules[0],
    id: 10,
    domain: 'other.example.com',
    headerName: 'X-Other',
    headerValue: 'ordinary',
    enabled: false
  });
  return {
    ...fixture,
    activation: createDefaultActivation(),
    currentHostname: 'api.example.com',
    scope: 'site',
    collapsedDomains: new Set(),
    revealedRuleIds: new Set(),
    grantedOrigins: null
  };
}

test('popup rule models scope both counts to the selected profile but retain the global manager count', () => {
  const snapshot = ruleSnapshot();
  const model = getPopupRuleViewModel(snapshot);
  assert.equal(model.currentSiteCount, 1);
  assert.equal(model.allRulesCount, 2);
  assert.equal(model.managerLinkLabel, 'Manage profiles and all 4 rules →');
  assert.deepEqual(
    model.rows.map(({ rule }) => rule.id),
    [1]
  );
  assert.deepEqual(model.groups, []);
  snapshot.scope = 'all';
  snapshot.collapsedDomains.add('api.example.com');
  snapshot.revealedRuleIds.add(1);
  const all = getPopupRuleViewModel(snapshot);
  assert.equal(all.visibleRuleCount, 2);
  assert.deepEqual(
    all.groups.map((group) => group.domain),
    ['api.example.com', 'other.example.com']
  );
  assert.equal(all.groups[0].currentSite, true);
  assert.equal(all.groups[0].collapsed, true);
  assert.equal(all.groups[0].rows[0].options.revealed, true);
});

test('unavailable-site fallback is derived without mutating a frozen snapshot or UI sets', () => {
  const snapshot = ruleSnapshot();
  snapshot.currentHostname = '';
  snapshot.activation = null;
  snapshot.rules.forEach(Object.freeze);
  Object.freeze(snapshot.rules);
  Object.freeze(snapshot);
  const before = structuredClone(snapshot);
  const model = getPopupRuleViewModel(snapshot);
  assert.equal(model.scope, 'all');
  assert.equal(model.currentSiteCount, 0);
  assert.equal(model.addRuleDisabled, true);
  assert.equal(model.visibleRuleCount, 2);
  assert.equal(snapshot.scope, 'site');
  assert.deepEqual(snapshot, before);
});

test('parked-profile display uses the last selected profile and unknown grants do not generate warnings', () => {
  const snapshot = ruleSnapshot();
  snapshot.activation = { ...createDefaultActivation(), profileId: null, lastProfileId: 'qa' };
  const model = getPopupRuleViewModel(snapshot);
  assert.deepEqual(
    model.rows.map(({ rule }) => rule.id),
    [4]
  );
  assert.equal(model.allRulesCount, 2);
  assert.equal(model.rows[0].options.needsAccess, false);
  snapshot.grantedOrigins = new Set();
  assert.equal(getPopupRuleViewModel(snapshot).rows[0].options.needsAccess, true);
  snapshot.composerOpen = true;
  assert.equal(getPopupRuleViewModel(snapshot).addRuleDisabled, true);
});

test('popup row and group conflict metadata is prepared consistently for the active profile', () => {
  const snapshot = ruleSnapshot();
  const first = snapshot.rules[0];
  snapshot.rules.push({ ...first, id: 11, headerValue: 'different', pathPrefix: '/api' });
  const currentSite = getPopupRuleViewModel(snapshot);
  assert.deepEqual(
    currentSite.rows[0].options.conflictingRules.map((rule) => rule.id),
    [11]
  );
  const all = getPopupRuleViewModel({ ...snapshot, scope: 'all' });
  assert.equal(all.groups[0].conflictCount, 1);
  assert.deepEqual(
    all.groups[0].rows.map(({ rule }) => rule.id),
    [1, 11]
  );
  const paused = getPopupRuleViewModel({
    ...snapshot,
    activation: { ...createDefaultActivation(), masterEnabled: false }
  });
  assert.ok(paused.rows.every(({ options }) => options.conflictingRules.length === 0));
});

test('empty popup rule models retain explicit counts and flags for rendering', () => {
  const model = getPopupRuleViewModel({ rules: [] });
  assert.equal(model.scope, 'all');
  assert.equal(model.visibleRuleCount, 0);
  assert.equal(model.allRulesCount, 0);
  assert.equal(model.hasRules, false);
  assert.deepEqual(model.rows, []);
  assert.deepEqual(model.groups, []);
});

test('popup activation summary keeps the common state compact', () => {
  const activation = createDefaultActivation();

  assert.deepEqual(getActivationDisplay(profiles, activation, now), {
    profileName: 'Default',
    appliedUntil: 'Until turned off'
  });
});

test('popup activation summary describes timers and browser-session scope', () => {
  const timed = {
    ...createDefaultActivation(),
    profileId: 'staging',
    lastProfileId: 'staging',
    expiresAt: now + 3_600_000,
    durationMs: 3_600_000
  };
  const sessionScoped = {
    ...timed,
    expiresAt: null,
    durationMs: null,
    untilBrowserClose: true
  };

  assert.deepEqual(getActivationDisplay(profiles, timed, now), {
    profileName: 'Staging',
    appliedUntil: '1h left'
  });
  assert.deepEqual(getActivationDisplay(profiles, sessionScoped, now), {
    profileName: 'Staging',
    appliedUntil: 'Chrome closes'
  });
});

test('popup activation summary makes a parked profile explicit', () => {
  const parked = {
    ...createDefaultActivation(),
    profileId: null,
    lastProfileId: 'staging'
  };

  assert.deepEqual(getActivationDisplay(profiles, parked, now), {
    profileName: 'Staging',
    appliedUntil: 'Paused'
  });
});

test('popup manager link describes profiles and the total rule count', () => {
  assert.equal(getManagerLinkLabel(0), 'Manage profiles and rules →');
  assert.equal(getManagerLinkLabel(1), 'Manage profiles and 1 rule →');
  assert.equal(getManagerLinkLabel(4), 'Manage profiles and all 4 rules →');
});

test('popup manager targets are built in one testable place', () => {
  assert.equal(getManagerPath(), 'options/index.html');
  assert.equal(getManagerPath({ section: 'active-setup' }), 'options/index.html#active-setup');
});
