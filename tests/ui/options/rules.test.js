import assert from 'node:assert/strict';
import test from 'node:test';
import { state } from '../../../extension/options/state.js';
import { renderRules } from '../../../extension/options/rules/view.js';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

test('manager rendering retains the live edit form, draft, locking, focus and selection', (t) => {
  const harness = createUiHarness(t);
  Object.assign(state, {
    rules: [{ id: 1, domain: 'example.com', headerName: 'X-Test', headerValue: 'stored', enabled: true, profileId: 'default' }],
    profiles: [{ id: 'default', name: 'Default' }],
    activation: createDefaultActivation(),
    editingId: 1,
    collapsedDomains: new Set(),
    revealedRuleIds: new Set([1]),
    searchQuery: ''
  });
  const input = harness.element('editHeaderValue-1');
  input.value = 'unsaved draft';
  input.selectionStart = 2;
  input.selectionEnd = 7;
  input.setSelectionRange = (start, end) => {
    assert.deepEqual([start, end], [2, 7]);
  };
  input.focus();
  const form = { dataset: { id: '1' }, contains: (node) => node === input, disabled: true };
  let restored;
  const replacement = { replaceWith: (node) => { restored = node; } };
  let reads = 0;
  harness.element('ruleListContainer').querySelector = () => reads++ === 0 ? form : replacement;
  renderRules();
  assert.equal(restored, form);
  assert.equal(restored.disabled, true);
  assert.equal(input.value, 'unsaved draft');
  assert.equal(document.activeElement, input);
  assert.equal(state.revealedRuleIds.has(1), true);
});