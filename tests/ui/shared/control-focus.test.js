import assert from 'node:assert/strict';
import test from 'node:test';

import { bindComposerEvents as bindOptionsComposer } from '../../../extension/options/rules/composer.js';
import { bindComposerEvents as bindPopupComposer } from '../../../extension/popup/headers/composer.js';
import { keepControlFocus } from '../../../extension/shared/ui/ui.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

function createDocument(t) {
  const original = globalThis.document;
  const body = { id: 'body' };
  globalThis.document = { activeElement: body, body };
  t.after(() => {
    globalThis.document = original;
  });
  return body;
}

function createControl() {
  const control = {
    checkVisibility: () => true,
    focus() {
      document.activeElement = control;
    }
  };
  return control;
}

function hide(control) {
  control.checkVisibility = () => false;
  control.focus = () => {};
}

test('a control takes focus back after disabling dropped it', (t) => {
  const body = createDocument(t);
  const control = createControl();
  control.focus();
  const restore = keepControlFocus();
  document.activeElement = body;
  restore();
  assert.equal(document.activeElement, control);
});

test('focus that moved elsewhere is not taken back', (t) => {
  createDocument(t);
  const control = createControl();
  control.focus();
  const restore = keepControlFocus();
  const errorField = createControl();
  errorField.focus();
  restore();
  assert.equal(document.activeElement, errorField);
});

test('a control that stays hidden hands focus to the fallback', (t) => {
  const body = createDocument(t);
  const hidden = createControl();
  const fallback = createControl();
  hidden.focus();
  const restore = keepControlFocus(fallback);
  hide(hidden);
  document.activeElement = body;
  restore();
  assert.equal(document.activeElement, fallback);
});

test('a hidden control Chrome still reports as active hands focus to the fallback', (t) => {
  createDocument(t);
  const hidden = createControl();
  const fallback = createControl();
  hidden.focus();
  const restore = keepControlFocus(fallback);
  hide(hidden);
  restore();
  assert.equal(document.activeElement, fallback);
});

test('without a fallback, a control that stays hidden leaves focus where it is', (t) => {
  const body = createDocument(t);
  const hidden = createControl();
  hidden.focus();
  const restore = keepControlFocus();
  hide(hidden);
  document.activeElement = body;
  restore();
  assert.equal(document.activeElement, body);
});

test('nothing moves when no control had focus to begin with', (t) => {
  const body = createDocument(t);
  const fallback = createControl();
  const restore = keepControlFocus(fallback);
  restore();
  assert.equal(document.activeElement, body);
});

for (const [surface, bindComposer] of [
  ['options', bindOptionsComposer],
  ['popup', bindPopupComposer]
]) {
  test(`${surface} add rule button keeps focus when a save is rejected`, async (t) => {
    const harness = createUiHarness(t);
    const onAddRule = async () => {
      document.activeElement = document.body;
      return false;
    };
    bindComposer({ onAddRule, onSaveRule: onAddRule });
    const addButton = harness.element('addHeaderBtn');
    addButton.focus();
    await harness.element('headerComposerForm').dispatch('submit', { preventDefault() {} });
    assert.equal(addButton.disabled, false);
    assert.equal(document.activeElement, addButton);
  });

  test(`${surface} add rule leaves focus on an error field`, async (t) => {
    const harness = createUiHarness(t);
    const onAddRule = async () => {
      harness.element('headerValue').focus();
      return false;
    };
    bindComposer({ onAddRule, onSaveRule: onAddRule });
    harness.element('addHeaderBtn').focus();
    await harness.element('headerComposerForm').dispatch('submit', { preventDefault() {} });
    assert.equal(document.activeElement, harness.element('headerValue'));
  });
}
