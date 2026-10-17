import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSensitiveHeaderName,
  renderRuleEditForm,
  renderRuleRow,
  sortDomainGroups,
  sortRulesForDisplay
} from '../../../extension/shared/ui/rule-render.js';

test('rule display sorting prioritizes conflicts, then active rules', () => {
  const rules = [
    { id: 1, enabled: false },
    { id: 2, enabled: true },
    { id: 3, enabled: true },
    { id: 4, enabled: false }
  ];

  const sortedRules = sortRulesForDisplay(rules, new Set([3, 4]));

  assert.deepEqual(sortedRules.map((rule) => rule.id), [3, 4, 2, 1]);
  assert.deepEqual(rules.map((rule) => rule.id), [1, 2, 3, 4]);
});

test('sensitive header detection covers common credential headers', () => {
  ['Authorization', 'X-Authorization', 'Cookie', 'X-Auth-Token', 'X-API-Key', 'client-secret'].forEach((headerName) => {
    assert.equal(isSensitiveHeaderName(headerName), true, headerName);
  });

  ['Accept-Language', 'X-Debug-Mode', 'Content-Type'].forEach((headerName) => {
    assert.equal(isSensitiveHeaderName(headerName), false, headerName);
  });
});

test('scoped rules expose their scope and editable controls', () => {
  const rule = {
    id: 7,
    domain: 'api.example.com',
    headerName: 'Authorization',
    headerValue: 'Bearer secret',
    enabled: true,
    pathPrefix: '/api/v1',
    resourceType: 'xmlhttprequest'
  };

  const row = renderRuleRow(rule);
  const editor = renderRuleEditForm(rule);

  assert.match(row, /Path <code>\/api\/v1<\/code> and subpaths/);
  assert.match(row, /Fetch\/XHR only/);
  assert.match(editor, /id="editPathPrefix-7"[^>]*value="\/api\/v1"/);
  assert.match(editor, /id="editResourceType-7"/);
  assert.match(editor, /option value="xmlhttprequest" selected/);
});

test('Unicode path prefixes remain readable in lists and edit forms', () => {
  const rule = {
    id: 7, domain: 'api.example.com', headerName: 'X-Test', headerValue: 'value',
    pathPrefix: '/caf%C3%A9', enabled: true
  };
  assert.ok(renderRuleRow(rule).includes('/caf\u00e9'));
  assert.ok(renderRuleEditForm(rule).includes('value="/caf\u00e9"'));
  const encodedSlash = renderRuleEditForm({ ...rule, pathPrefix: '/a%2Fb' });
  assert.match(encodedSlash, /value="\/a%2Fb"/);
});

test('paused rules are clearly marked while remaining editable and resumable', () => {
  const row = renderRuleRow({
    id: 9,
    domain: 'api.example.com',
    headerName: 'X-Debug',
    headerValue: 'on',
    enabled: false
  }, { needsAccess: true });

  assert.match(row, /aria-checked="false"[^>]*aria-label="Resume X-Debug rule"/);
  assert.match(row, /class="rule-enable-label">Paused</);
  assert.match(row, /data-rule-action="edit"/);
  assert.match(row, /data-rule-action="delete"/);
  assert.match(row, /doesn't have site access to <code>api\.example\.com<\/code>/);
  assert.match(row, /data-rule-action="grant"[^>]*>Grant</);
});

test('default host-wide rules do not add scope noise', () => {
  const rule = {
    id: 8,
    domain: 'api.example.com',
    headerName: 'X-Debug',
    headerValue: 'on',
    enabled: true
  };

  assert.doesNotMatch(renderRuleRow(rule), /rule-scope-summary/);
});

test('domain groups lead with conflicts, then the current site, then alphabetically', () => {
  const groups = [
    { domain: 'zeta.example.com', rules: [{ id: 1, enabled: true }] },
    { domain: 'alpha.example.com', rules: [{ id: 2, enabled: true }] },
    { domain: 'current.example.com', rules: [{ id: 3, enabled: true }] },
    { domain: 'clash.example.com', rules: [{ id: 4, enabled: true }] }
  ];

  const sorted = sortDomainGroups(groups, new Set([4]), 'current.example.com');

  assert.deepEqual(sorted.map((group) => group.domain), [
    'clash.example.com',
    'current.example.com',
    'alpha.example.com',
    'zeta.example.com'
  ]);
});
