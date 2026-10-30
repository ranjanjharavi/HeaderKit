import assert from 'node:assert/strict';
import test from 'node:test';

import { getRuleWorkspaceSummary, getRuleWorkspaceViewModel } from '../../../extension/options/view-model.js';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { createBackupFixture } from '../../helpers/backup.js';

function workspaceSnapshot() {
  const fixture = createBackupFixture();
  fixture.rules.push(
    ...Array.from({ length: 5 }, (_, index) => ({
      ...fixture.rules[0],
      id: 10 + index,
      domain: 'other.example.com',
      headerName: index === 0 ? 'X-Only' : `X-Other-${index}`
    }))
  );
  return {
    ...fixture,
    activation: createDefaultActivation(),
    searchQuery: '',
    editingId: null,
    collapsedDomains: new Set(),
    revealedRuleIds: new Set(),
    grantedOrigins: null
  };
}

function visibleIds(model) {
  return model.groups.flatMap((group) => group.rows.map(({ rule }) => rule.id));
}

test('workspace models filter hosts and header names without searching credential values', () => {
  const snapshot = workspaceSnapshot();
  const model = getRuleWorkspaceViewModel({ ...snapshot, searchQuery: ' x-oNlY ' });
  assert.equal(model.searchEnabled, true);
  assert.equal(model.searchQuery, ' x-oNlY ');
  assert.equal(model.summary.totalRules, 6);
  assert.deepEqual(visibleIds(model), [10]);
  assert.deepEqual(visibleIds(getRuleWorkspaceViewModel({ ...snapshot, searchQuery: 'api.example.com' })), [1]);
  assert.deepEqual(visibleIds(getRuleWorkspaceViewModel({ ...snapshot, searchQuery: 'backup-test-secret' })), []);
});

test('search availability is based on the selected profile and does not clear the input snapshot', () => {
  const snapshot = workspaceSnapshot();
  snapshot.activation.profileId = 'qa';
  snapshot.searchQuery = 'unmatched';
  Object.freeze(snapshot);
  const model = getRuleWorkspaceViewModel(snapshot);
  assert.equal(model.summary.totalRules, 2);
  assert.equal(model.searchEnabled, false);
  assert.equal(model.searchQuery, '');
  assert.deepEqual(visibleIds(model), [4, 9]);
  assert.equal(snapshot.searchQuery, 'unmatched');
});

test('editing rows stay visible under search and force only their own collapsed group open', () => {
  const snapshot = workspaceSnapshot();
  snapshot.editingId = 1;
  snapshot.searchQuery = 'X-Only';
  snapshot.collapsedDomains = new Set(['api.example.com', 'other.example.com']);
  snapshot.revealedRuleIds.add(1);
  snapshot.rules.forEach(Object.freeze);
  Object.freeze(snapshot.rules);
  Object.freeze(snapshot);
  const before = structuredClone(snapshot);
  const model = getRuleWorkspaceViewModel(snapshot);
  assert.deepEqual(visibleIds(model), [1, 10]);
  assert.equal(model.groups[0].collapsed, false);
  assert.equal(model.groups[1].collapsed, true);
  assert.equal(model.groups[0].rows[0].options.editing, true);
  assert.equal(model.groups[0].rows[0].options.revealed, true);
  assert.equal(model.groups[0].rows[0].options.editProfiles, snapshot.profiles);
  assert.equal(model.addRuleDisabled, true);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(visibleIds(getRuleWorkspaceViewModel({ ...snapshot, searchQuery: 'Authorization' })), [1]);
});

test('workspace models preserve default activation and composer locking without manufacturing missing editors', () => {
  const snapshot = workspaceSnapshot();
  snapshot.activation = null;
  snapshot.editingId = 999;
  const model = getRuleWorkspaceViewModel(snapshot);
  assert.equal(model.summary.totalRules, 6);
  assert.equal(model.addRuleDisabled, true);
  assert.ok(model.groups.flatMap((group) => group.rows).every(({ options }) => !options.editing));
  assert.equal(getRuleWorkspaceViewModel({ ...snapshot, editingId: null, composerOpen: true }).addRuleDisabled, true);
  const empty = getRuleWorkspaceViewModel({ rules: [] });
  assert.deepEqual(empty.groups, []);
  assert.equal(empty.searchQuery, '');
  assert.equal(empty.addRuleDisabled, false);
});

test('workspace conflict presentation follows activation and excludes rules in another profile', () => {
  const fixture = createBackupFixture();
  const first = fixture.rules[0];
  const rules = [
    { ...first, id: 3, headerName: 'X-Ordinary' },
    first,
    { ...first, id: 2, headerValue: 'different', pathPrefix: '/api' },
    { ...first, id: 4, profileId: 'qa', headerValue: 'inactive' }
  ];
  const model = getRuleWorkspaceViewModel({ rules, activation: createDefaultActivation() });
  assert.equal(model.groups[0].conflictCount, 1);
  assert.deepEqual(
    model.groups[0].rows.map(({ rule }) => rule.id),
    [1, 2, 3]
  );
  assert.deepEqual(
    model.groups[0].rows[0].options.conflictingRules.map((rule) => rule.id),
    [2]
  );
  const paused = getRuleWorkspaceViewModel({
    rules,
    activation: { ...createDefaultActivation(), masterEnabled: false }
  });
  assert.equal(paused.groups[0].conflictCount, 0);
  assert.ok(paused.groups[0].rows.every(({ options }) => options.conflictingRules.length === 0));
});

test('rule workspace summary describes an empty view', () => {
  assert.deepEqual(getRuleWorkspaceSummary([]), {
    totalRules: 0,
    activeRules: 0,
    hostCount: 0,
    detail: 'No rules in this view.'
  });
});

test('rule workspace summary handles host grammar and enabled counts', () => {
  assert.deepEqual(
    getRuleWorkspaceSummary([
      { domain: 'api.example.com', enabled: true },
      { domain: 'api.example.com', enabled: false }
    ]),
    {
      totalRules: 2,
      activeRules: 1,
      hostCount: 1,
      detail: '2 rules applying to 1 host'
    }
  );

  assert.deepEqual(
    getRuleWorkspaceSummary([
      { domain: 'api.example.com', enabled: true },
      { domain: 'staging.example.com', enabled: true }
    ]),
    {
      totalRules: 2,
      activeRules: 2,
      hostCount: 2,
      detail: '2 rules applying to 2 hosts'
    }
  );
});
