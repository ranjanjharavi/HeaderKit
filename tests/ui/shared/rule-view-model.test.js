import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConflictMap,
  createDomainGroupModel,
  createRuleRowModel,
  sortDomainGroups,
  sortRulesForDisplay
} from '../../../extension/shared/ui/rule-view-model.js';
import { renderDomainGroup } from '../../../extension/shared/ui/rule-render.js';

function rule(id, enabled = true) {
  return {
    id,
    domain: 'api.example.com',
    headerName: `X-Test-${id}`,
    headerValue: 'value',
    enabled,
    profileId: 'default'
  };
}

test('conflict maps preserve both directions and every peer without modifying input pairs', () => {
  const rules = [rule(1), rule(2), rule(3)];
  const conflicts = [
    { leftRule: rules[0], rightRule: rules[1] },
    { leftRule: rules[0], rightRule: rules[2] }
  ];
  const before = structuredClone(conflicts);
  const map = createConflictMap(conflicts);
  assert.deepEqual(map.get(1), [rules[1], rules[2]]);
  assert.deepEqual(map.get(2), [rules[0]]);
  assert.deepEqual(map.get(3), [rules[0]]);
  assert.deepEqual(conflicts, before);
  assert.equal(createConflictMap([]).size, 0);
});

test('rule sorting is stable within equal priority and leaves frozen input arrays untouched', () => {
  const rules = Object.freeze([rule(1, false), rule(2), rule(3), rule(4, false)]);
  const sorted = sortRulesForDisplay(rules, new Set([3, 4]));
  assert.deepEqual(
    sorted.map((item) => item.id),
    [3, 4, 2, 1]
  );
  assert.deepEqual(
    sortRulesForDisplay(Object.freeze([rule(3), rule(1), rule(2)])).map((item) => item.id),
    [3, 1, 2]
  );
  assert.deepEqual(
    rules.map((item) => item.id),
    [1, 2, 3, 4]
  );
});

test('group sorting does not reorder group arrays or nested rule arrays', () => {
  const groups = Object.freeze([
    Object.freeze({ domain: 'zeta.example.com', rules: Object.freeze([rule(1)]) }),
    Object.freeze({ domain: 'alpha.example.com', rules: Object.freeze([rule(2)]) }),
    Object.freeze({ domain: 'current.example.com', rules: Object.freeze([rule(3)]) }),
    Object.freeze({ domain: 'clash.example.com', rules: Object.freeze([rule(4)]) })
  ]);
  assert.deepEqual(
    sortDomainGroups(groups, new Set([4]), 'current.example.com').map((group) => group.domain),
    ['clash.example.com', 'current.example.com', 'alpha.example.com', 'zeta.example.com']
  );
  assert.equal(groups[0].domain, 'zeta.example.com');
  assert.equal(groups[0].rules[0].id, 1);
});

test('row models carry editing and reveal state without changing the supplied rule or sets', () => {
  const current = Object.freeze(rule(1, false));
  const revealedRuleIds = new Set([1]);
  const profiles = [{ id: 'default', name: 'Default' }];
  const model = createRuleRowModel(current, {
    editingId: 1,
    revealedRuleIds,
    editProfiles: profiles,
    grantedOrigins: new Set()
  });
  assert.equal(model.rule, current);
  assert.equal(model.options.editing, true);
  assert.equal(model.options.revealed, true);
  assert.equal(model.options.editProfiles, profiles);
  // Saved paused rules still disclose missing access, as before the extraction.
  assert.equal(model.options.needsAccess, true);
  assert.deepEqual([...revealedRuleIds], [1]);
  assert.equal(current.enabled, false);
});

test('unknown grants hide access warnings while known exact, broad and wildcard coverage is respected', () => {
  const current = rule(1);
  assert.equal(createRuleRowModel(current).options.needsAccess, false);
  assert.equal(createRuleRowModel(current, { grantedOrigins: null }).options.needsAccess, false);
  assert.equal(createRuleRowModel(current, { grantedOrigins: new Set() }).options.needsAccess, true);
  for (const origin of ['https://api.example.com/*', 'https://*/*', 'https://*.example.com/*']) {
    assert.equal(createRuleRowModel(current, { grantedOrigins: new Set([origin]) }).options.needsAccess, false);
  }
});

test('group models calculate counts, summaries and row order and keep a collapsed live editor visible', () => {
  const rules = Object.freeze([Object.freeze(rule(3, false)), Object.freeze(rule(1)), Object.freeze(rule(2))]);
  const conflicts = createConflictMap([{ leftRule: rules[1], rightRule: rules[2] }]);
  const model = createDomainGroupModel('api.example.com', rules, {
    index: 7,
    conflictMap: conflicts,
    collapsed: true,
    currentHostname: 'api.example.com',
    editingId: 3,
    managerView: true
  });
  assert.equal(model.groupId, 'domainRuleGroup-7');
  assert.equal(model.currentSite, true);
  assert.equal(model.collapsed, false);
  assert.equal(model.conflictCount, 1);
  assert.equal(model.conflictLabel, 'conflict');
  assert.equal(model.summary, '3 rules · 2 on');
  assert.deepEqual(
    model.rows.map(({ rule }) => rule.id),
    [1, 2, 3]
  );
  assert.equal(model.rows[2].options.editing, true);
  assert.deepEqual(
    rules.map((rule) => rule.id),
    [3, 1, 2]
  );
});

test('popup group summaries keep active/paused grammar and preserve collapsed state without an editor', () => {
  const active = createDomainGroupModel('api.example.com', [rule(1)], { index: 0, collapsed: true });
  assert.equal(active.summary, '1 active');
  assert.equal(active.collapsed, true);
  assert.equal(createDomainGroupModel('api.example.com', [rule(1, false)], { index: 0 }).summary, '1 paused');
  assert.equal(
    createDomainGroupModel('api.example.com', [rule(1), rule(2, false)], { index: 0 }).summary,
    '1 active · 1 paused'
  );
  const rules = [rule(1), rule(2), rule(3)];
  const conflictMap = createConflictMap([
    { leftRule: rules[0], rightRule: rules[1] },
    { leftRule: rules[0], rightRule: rules[2] }
  ]);
  const grouped = createDomainGroupModel('api.example.com', rules, { index: 0, conflictMap });
  assert.equal(grouped.conflictCount, 2);
  assert.equal(grouped.conflictLabel, 'conflicts');
});

test('group rendering consumes prepared metadata, keeping markup and escaping separate from ordering', () => {
  const model = createDomainGroupModel('api.example.com', [rule(1), rule(2, false)], { index: 2, collapsed: true });
  const html = renderDomainGroup({ ...model, domain: 'api.example.com" data-injected="yes' });
  assert.match(html, /aria-expanded="false" aria-controls="domainRuleGroup-2"/);
  assert.match(html, /id="domainRuleGroup-2" class="domain-rule-list" hidden/);
  assert.match(html, /1 active · 1 paused/);
  assert.match(html, /data-domain="api.example.com&quot; data-injected=&quot;yes"/);
  assert.doesNotMatch(html, / data-injected="yes/);
  assert.ok(html.indexOf('data-id="1"') < html.indexOf('data-id="2"'));
});
