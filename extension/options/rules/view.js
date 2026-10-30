import { renderDomainGroup } from '../../shared/ui/rule-render.js';

/** Render a prepared model without changing page state or replacing a live editor. */
export function renderRules(model) {
  const container = document.getElementById('ruleListContainer');
  const previousForm = container.querySelector('.rule-edit-form');
  const preservedForm = Number(previousForm?.dataset.id) === model.editingId ? previousForm : null;
  const focusedInput = preservedForm?.contains(document.activeElement) ? document.activeElement : null;
  const selectionStart = focusedInput?.selectionStart;
  const selectionEnd = focusedInput?.selectionEnd;
  updateSummary(model);

  if (!model.groups.length) {
    container.innerHTML = getEmptyRulesMessage(model.searchQuery);
    syncAddRuleActions(model.addRuleDisabled);
    return;
  }
  container.innerHTML = model.groups.map(renderDomainGroup).join('');
  const replacement = container.querySelector('.rule-edit-form');
  if (preservedForm && replacement) {
    replacement.replaceWith(preservedForm);
    focusedInput?.focus({ preventScroll: true });
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      focusedInput.setSelectionRange(selectionStart, selectionEnd);
    }
  }
  syncAddRuleActions(model.addRuleDisabled);
}

export function syncAddRuleActions(disabled) {
  document.getElementById('headerComposerToggle').disabled = disabled;
  document.querySelectorAll('[data-rule-action="open-composer"]').forEach((button) => {
    button.disabled = disabled;
  });
}

function updateSummary({ summary, searchEnabled, searchQuery }) {
  document.getElementById('rulesCount').textContent = String(summary.totalRules);
  document.getElementById('optionsSummary').textContent = summary.detail;
  document.getElementById('ruleSearchContainer').hidden = !searchEnabled;
  document.getElementById('rulesToolbar').hidden = !searchEnabled;
  const searchInput = document.getElementById('ruleSearchInput');
  if (searchInput.value !== searchQuery) {
    searchInput.value = searchQuery;
  }
}

function getEmptyRulesMessage(searchQuery) {
  if (searchQuery.trim()) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M7 2a5 5 0 1 0 3.16 8.87l2.98 2.98 1.06-1.06-2.98-2.98A5 5 0 0 0 7 2Zm-3.5 5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"/></svg></div>
        <p class="empty-state-title">No matching rules</p>
        <p>Try a different host or header.</p>
        <button class="secondary-btn empty-state-action" type="button" data-rule-action="clear-search">Clear search</button>
      </div>
    `;
  }
  return `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M7.25 2.5h1.5v4.75h4.75v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75V2.5Z"/></svg></div>
      <p class="empty-state-title">No header rules yet</p>
      <p>Add your first exact-host rule.</p>
      <button class="primary-btn empty-state-action" type="button" data-rule-action="open-composer">Add header rule</button>
    </div>
  `;
}
