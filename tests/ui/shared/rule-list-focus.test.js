import assert from 'node:assert/strict';
import test from 'node:test';

import { renderRules as renderOptionsRules } from '../../../extension/options/rules/view.js';
import { getRuleWorkspaceViewModel } from '../../../extension/options/view-model.js';
import { renderRules as renderPopupRules } from '../../../extension/popup/headers/view.js';
import { getPopupRuleViewModel } from '../../../extension/popup/view-model.js';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { keepRuleListFocus } from '../../../extension/shared/ui/rule-list-focus.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

function createControl(ruleAction, { id, domain, hidden = false, disabled = false, form = null, row = null } = {}) {
  const control = {
    dataset: { ruleAction, ...(id ? { id } : {}), ...(domain ? { domain } : {}) },
    disabled,
    closest(selector) {
      if (selector === '[hidden]') return hidden ? {} : null;
      if (selector === '.rule-edit-form') return form;
      if (selector === '.domain-rule-row') return row;
      return null;
    },
    focus() {
      document.activeElement = control;
    }
  };
  return control;
}

/** Each rendered row is `[id, ...actions]`, and every render replaces all the nodes. */
function createList(t) {
  const body = { id: 'body' };
  const addRule = { id: 'headerComposerToggle', disabled: false, focus: () => (document.activeElement = addRule) };
  const original = globalThis.document;
  globalThis.document = { activeElement: body, body, getElementById: () => addRule };
  t.after(() => {
    globalThis.document = original;
  });

  let controls = [];
  let rows = [];
  const list = {
    addRule,
    body,
    contains: (node) => controls.includes(node),
    querySelectorAll: (selector) => (selector === '.domain-rule-row' ? rows : controls),
    find: (ruleAction, id) => controls.find((c) => c.dataset.ruleAction === ruleAction && c.dataset.id === id),
    render(renderedRows, extraControls = []) {
      controls = [...extraControls];
      rows = renderedRows.map(([id, ...actions]) => {
        const row = {
          closest: () => null,
          querySelector: () => null
        };
        const rowControls = actions.map((action) => createControl(action, { id, row }));
        row.querySelector = () => rowControls.find((c) => c.dataset.ruleAction === 'toggle') || null;
        controls.push(...rowControls);
        return row;
      });
      document.activeElement = body;
    }
  };
  return list;
}

test('the same control takes focus back after a re-render', (t) => {
  const list = createList(t);
  list.render([['1', 'toggle', 'edit', 'delete']]);
  list.find('edit', '1').focus();
  const restore = keepRuleListFocus(list);
  list.render([['1', 'toggle', 'edit', 'delete']]);
  assert.equal(document.activeElement, list.body);
  restore();
  assert.equal(document.activeElement, list.find('edit', '1'));
});

test('a host group toggle is matched by its domain', (t) => {
  const list = createList(t);
  const groups = () => [
    createControl('toggle-domain', { domain: 'a.example.com' }),
    createControl('toggle-domain', { domain: 'b.example.com' })
  ];
  list.render([], groups());
  list.querySelectorAll('[data-rule-action]')[1].focus();
  const restore = keepRuleListFocus(list);
  list.render([], groups());
  restore();
  assert.equal(document.activeElement.dataset.domain, 'b.example.com');
});

test('focus elsewhere on the page is left alone', (t) => {
  const list = createList(t);
  list.render([['1', 'toggle']]);
  const search = {};
  document.activeElement = search;
  const restore = keepRuleListFocus(list);
  list.render([['1', 'toggle']]);
  document.activeElement = search;
  restore();
  assert.equal(document.activeElement, search);
});

test('focus that moved elsewhere before the restore is not taken back', (t) => {
  const list = createList(t);
  list.render([['1', 'toggle']]);
  list.find('toggle', '1').focus();
  const restore = keepRuleListFocus(list);
  list.render([['1', 'toggle']]);
  const search = {};
  document.activeElement = search;
  restore();
  assert.equal(document.activeElement, search);
});

test('focus already back inside the list is not overridden', (t) => {
  const list = createList(t);
  list.render([['1', 'toggle']]);
  list.find('toggle', '1').focus();
  const restore = keepRuleListFocus(list);
  list.render([['1', 'toggle', 'edit']]);
  list.find('edit', '1').focus();
  restore();
  assert.equal(document.activeElement, list.find('edit', '1'));
});

test('closing an edit form returns focus to that rule edit button', (t) => {
  const list = createList(t);
  const form = { dataset: { id: '2' } };
  const input = createControl(undefined, { form });
  list.render([['1', 'toggle', 'edit']], [input]);
  input.focus();
  const restore = keepRuleListFocus(list);
  list.render([
    ['1', 'toggle', 'edit'],
    ['2', 'toggle', 'edit']
  ]);
  restore();
  assert.equal(document.activeElement, list.find('edit', '2'));
});

test('when its button goes away, focus stays on the same rule', (t) => {
  const list = createList(t);
  list.render([
    ['1', 'toggle'],
    ['2', 'toggle', 'grant']
  ]);
  list.find('grant', '2').focus();
  const restore = keepRuleListFocus(list);
  list.render([
    ['1', 'toggle'],
    ['2', 'toggle']
  ]);
  restore();
  assert.equal(document.activeElement, list.find('toggle', '2'));
});

test('when a rule goes away, focus moves to the rule in its place, or to the last one', (t) => {
  const list = createList(t);
  list.render([
    ['1', 'toggle', 'delete'],
    ['2', 'toggle', 'delete'],
    ['3', 'toggle', 'delete']
  ]);
  list.find('delete', '2').focus();
  let restore = keepRuleListFocus(list);
  list.render([
    ['1', 'toggle', 'delete'],
    ['3', 'toggle', 'delete']
  ]);
  restore();
  assert.equal(document.activeElement, list.find('toggle', '3'));

  list.find('delete', '3').focus();
  restore = keepRuleListFocus(list);
  list.render([['1', 'toggle', 'delete']]);
  restore();
  assert.equal(document.activeElement, list.find('toggle', '1'));
});

test('collapsed and disabled controls cannot take focus', (t) => {
  const list = createList(t);
  list.render([], [createControl('grant', { id: '9' })]);
  list.querySelectorAll('[data-rule-action]')[0].focus();
  const restore = keepRuleListFocus(list);
  const available = createControl('toggle-domain', { domain: 'open.example.com' });
  list.render(
    [],
    [createControl('grant', { id: '9', hidden: true }), createControl('toggle', { id: '9', disabled: true }), available]
  );
  restore();
  assert.equal(document.activeElement, available);
});

test('an empty list falls back to its empty-state action, then the add rule button', (t) => {
  const list = createList(t);
  list.render([['1', 'toggle', 'delete']]);
  list.find('delete', '1').focus();
  let restore = keepRuleListFocus(list);
  const openComposer = createControl('open-composer');
  list.render([], [openComposer]);
  restore();
  assert.equal(document.activeElement, openComposer);

  list.render([['1', 'toggle', 'delete']]);
  list.find('delete', '1').focus();
  restore = keepRuleListFocus(list);
  list.render([]);
  restore();
  assert.equal(document.activeElement, list.addRule);

  list.addRule.disabled = true;
  list.render([['1', 'toggle', 'delete']]);
  list.find('delete', '1').focus();
  restore = keepRuleListFocus(list);
  list.render([]);
  restore();
  assert.equal(document.activeElement, list.body);
});

const rule = {
  id: 1,
  domain: 'example.com',
  headerName: 'X-Test',
  headerValue: 'stored',
  enabled: true,
  profileId: 'default'
};
const activation = createDefaultActivation();

for (const [surface, render] of [
  ['options', () => renderOptionsRules(getRuleWorkspaceViewModel({ rules: [rule], activation }))],
  ['popup', () => renderPopupRules(getPopupRuleViewModel({ rules: [rule], activation, currentHostname: rule.domain }))]
]) {
  test(`${surface} rule list keeps focus when it re-renders`, (t) => {
    const harness = createUiHarness(t);
    const container = harness.element('ruleListContainer');
    let controls = [createControl('toggle', { id: '1' })];
    container.contains = (node) => controls.includes(node);
    container.querySelectorAll = (selector) => (selector === '[data-rule-action]' ? controls : []);
    Object.defineProperty(container, 'innerHTML', {
      set() {
        controls = [createControl('toggle', { id: '1' })];
        document.activeElement = harness.element('body');
      }
    });
    controls[0].focus();
    render();
    assert.equal(document.activeElement, controls[0]);
  });
}
