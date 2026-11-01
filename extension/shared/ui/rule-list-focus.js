/**
 * Replacing a rule list's markup drops keyboard focus to the page body.
 * Call this before replacing it and the returned function after, to put focus back on the same control or, when that control has gone, on the nearest one left.
 */
export function keepRuleListFocus(container) {
  const focused = document.activeElement;
  if (!focused || !container.contains(focused)) {
    return () => {};
  }
  const editForm = focused.closest('.rule-edit-form');
  const wanted = editForm
    ? { ruleAction: 'edit', id: editForm.dataset.id }
    : { ruleAction: focused.dataset.ruleAction, id: focused.dataset.id, domain: focused.dataset.domain };
  const rowIndex = getVisibleRows(container).indexOf(focused.closest('.domain-rule-row'));

  return () => {
    // Leave it if something else has taken focus, such as a retained edit form.
    if (document.activeElement === document.body) {
      findFocusTarget(container, wanted, rowIndex)?.focus();
    }
  };
}

function findFocusTarget(container, { ruleAction, id, domain }, rowIndex) {
  const controls = [...container.querySelectorAll('[data-rule-action]')].filter(
    (control) => !control.disabled && !control.closest('[hidden]')
  );
  const rows = getVisibleRows(container);
  return (
    controls.find(
      ({ dataset }) => dataset.ruleAction === ruleAction && dataset.id === id && dataset.domain === domain
    ) ||
    // Its own button went away, such as Grant once access is granted.
    (id && controls.find(({ dataset }) => dataset.id === id)) ||
    // The rule went away, so take the one now in its place.
    rows[Math.min(rowIndex, rows.length - 1)]?.querySelector('[data-rule-action="toggle"]') ||
    controls[0] ||
    getEnabledAddRuleButton()
  );
}

function getVisibleRows(container) {
  return [...container.querySelectorAll('.domain-rule-row')].filter((row) => !row.closest('[hidden]'));
}

function getEnabledAddRuleButton() {
  const addRule = document.getElementById('headerComposerToggle');
  return addRule?.disabled ? null : addRule;
}
