import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmDestructiveAction } from '../../../extension/shared/ui/confirmation-dialog.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.open = false;
    this.returnValue = '';
    this.textContent = '';
    this.focused = false;
  }

  showModal() {
    this.open = true;
  }

  close(returnValue = '') {
    this.open = false;
    this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  }

  focus() {
    this.focused = true;
  }
}

function createDialogDocument() {
  const elements = Object.fromEntries(
    [
      'confirmationDialog',
      'confirmationConfirmBtn',
      'confirmationCancelBtn',
      'confirmationTitle',
      'confirmationMessage'
    ].map((id) => [id, new FakeElement()])
  );

  return {
    elements,
    getElementById(id) {
      return elements[id];
    }
  };
}

test('HeaderKit confirmation resolves only after the destructive action is confirmed', async () => {
  const originalDocument = globalThis.document;
  const fakeDocument = createDialogDocument();
  globalThis.document = fakeDocument;

  try {
    const confirmation = confirmDestructiveAction({
      title: 'Delete X-Debug?',
      message: 'The rule will be permanently removed.',
      confirmLabel: 'Delete rule'
    });

    assert.equal(fakeDocument.elements.confirmationDialog.open, true);
    assert.equal(fakeDocument.elements.confirmationTitle.textContent, 'Delete X-Debug?');
    assert.equal(fakeDocument.elements.confirmationConfirmBtn.textContent, 'Delete rule');
    assert.equal(fakeDocument.elements.confirmationCancelBtn.focused, true);

    fakeDocument.elements.confirmationConfirmBtn.dispatchEvent(new Event('click'));
    assert.equal(await confirmation, true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('HeaderKit confirmation resolves false when cancelled', async () => {
  const originalDocument = globalThis.document;
  const fakeDocument = createDialogDocument();
  globalThis.document = fakeDocument;

  try {
    const confirmation = confirmDestructiveAction({
      title: 'Delete profile?',
      message: 'Its rules will also be deleted.'
    });

    fakeDocument.elements.confirmationCancelBtn.dispatchEvent(new Event('click'));
    assert.equal(await confirmation, false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('another action cannot replace a pending deletion confirmation', async () => {
  const originalDocument = globalThis.document;
  const fakeDocument = createDialogDocument();
  globalThis.document = fakeDocument;

  try {
    const first = confirmDestructiveAction({ title: 'Delete X-Test?', message: 'First rule.' });
    const second = confirmDestructiveAction({ title: 'Delete profile?', message: 'Another action.' });
    assert.equal(await second, false);
    assert.equal(fakeDocument.elements.confirmationTitle.textContent, 'Delete X-Test?');
    fakeDocument.elements.confirmationConfirmBtn.dispatchEvent(new Event('click'));
    assert.equal(await first, true);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('dismissing a dialog after a confirmed action does not confirm the next action', async () => {
  const originalDocument = globalThis.document;
  const fakeDocument = createDialogDocument();
  globalThis.document = fakeDocument;

  try {
    const first = confirmDestructiveAction({ title: 'Delete X-Test?', message: 'First rule.' });
    fakeDocument.elements.confirmationConfirmBtn.dispatchEvent(new Event('click'));
    assert.equal(await first, true);

    const second = confirmDestructiveAction({ title: 'Delete profile?', message: 'Another action.' });
    fakeDocument.elements.confirmationDialog.close();
    assert.equal(await second, false);
  } finally {
    globalThis.document = originalDocument;
  }
});
