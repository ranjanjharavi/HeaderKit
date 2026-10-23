import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSensitiveHeaderName,
  renderRuleEditForm,
  renderRuleRow,
  sortDomainGroups,
  sortRulesForDisplay
} from '../../../extension/shared/ui/rule-render.js';
import { bindHeaderValueFields, syncHeaderValueField } from '../../../extension/shared/ui/header-value.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

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
  [
    'Authorization', 'X-Authorization', 'Cookie', 'X-Auth-Token', 'X-API-Key', 'client-secret',
    'X-Auth', 'Session-Id', 'Password', 'X-Passwd', 'X-Signature', 'X-CSRF', 'X-XSRF',
    'Bearer', 'X-JWT', 'Credentials', 'X-Private', 'ApiKey', 'API_KEY'
  ].forEach((headerName) => {
    assert.equal(isSensitiveHeaderName(headerName), true, headerName);
    const rule = { id: 1, headerName, headerValue: 'credential-value', enabled: true };
    assert.doesNotMatch(renderRuleRow(rule), /credential-value/);
    assert.match(renderRuleEditForm(rule), /data-header-value type="password"[^>]*autocomplete="off"/);
  });

  ['Accept-Language', 'X-Debug-Mode', 'Content-Type'].forEach((headerName) => {
    assert.equal(isSensitiveHeaderName(headerName), false, headerName);
    assert.match(renderRuleEditForm({ id: 1, headerName, headerValue: 'ordinary' }), /data-header-value type="text"[^>]*autocomplete="off"/);
  });
});

test('header value controls mask, reveal and reset without changing the draft or focus', async (context) => {
  const harness = createUiHarness(context);
  const form = harness.element('form');
  const nameInput = harness.element('name');
  const valueInput = harness.element('value');
  const button = harness.element('reveal');
  const fields = {
    '[data-header-name]': nameInput,
    '[data-header-value]': valueInput,
    '[data-header-value-toggle]': button
  };
  form.querySelector = (selector) => fields[selector] || null;
  nameInput.matches = (selector) => selector === '[data-header-name]';
  nameInput.closest = () => form;
  button.closest = (selector) => selector === 'form' ? form : button;
  nameInput.value = 'Authorization';
  valueInput.value = 'draft secret';
  nameInput.focus();
  bindHeaderValueFields(form);
  syncHeaderValueField(form);
  assert.equal(valueInput.type, 'password');
  assert.equal(button.hidden, false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  await form.dispatch('click', { target: button });
  assert.equal(valueInput.type, 'text');
  assert.equal(button.getAttribute('aria-label'), 'Hide value');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.title, 'Hide value');
  await form.dispatch('click', { target: button });
  assert.equal(valueInput.type, 'password');
  await form.dispatch('click', { target: button });
  nameInput.value = 'X-Session';
  await form.dispatch('input', { target: nameInput });
  assert.equal(valueInput.type, 'password');
  nameInput.value = 'X-Debug';
  await form.dispatch('input', { target: nameInput });
  assert.equal(valueInput.type, 'text');
  assert.equal(button.hidden, true);
  nameInput.value = 'X-CSRF';
  await form.dispatch('input', { target: nameInput });
  assert.equal(valueInput.type, 'password');
  button.disabled = true;
  await form.dispatch('click', { target: button });
  assert.equal(valueInput.type, 'password');
  assert.equal(valueInput.value, 'draft secret');
  assert.equal(document.activeElement, nameInput);
});

test('rule switch attributes escape header names independently of validation', () => {
  const row = renderRuleRow({
    id: 1,
    domain: 'example.com',
    headerName: 'X-Test" data-injected="yes',
    headerValue: 'value',
    enabled: true
  });
  assert.match(row, /aria-label="Pause X-Test&quot; data-injected=&quot;yes rule"/);
  assert.match(row, /title="Pause X-Test&quot; data-injected=&quot;yes rule"/);
  assert.doesNotMatch(row, / data-injected="yes/);
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
