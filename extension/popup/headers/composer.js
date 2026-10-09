import { createSiteAccessPreflight } from '../../shared/ui/site-access-preflight.js';
import { clearRuleFormError } from '../../shared/ui/rule-form-errors.js';
import { state, getScopedRules } from '../state.js';
import { showStatus } from '../../shared/ui/ui.js';

export let siteAccessPreflight;
let addRule;
let saveEditedRule;

export function bindComposerEvents({ onAddRule, onSaveRule }) {
  addRule = onAddRule;
  saveEditedRule = onSaveRule;
  siteAccessPreflight = createSiteAccessPreflight({
    getDefaultSubmitLabel: () => state.headers.editingId ? 'Update rule' : 'Add rule'
  });
  document.getElementById('headerComposerToggle').addEventListener('click', toggleHeaderComposer);
  document.getElementById('cancelHeaderComposerBtn').addEventListener('click', cancelHeaderComposer);
  const form = document.getElementById('headerComposerForm');
  form.addEventListener('submit', handleComposerSubmit);
  form.addEventListener('keydown', handleComposerKeydown);
  form.addEventListener('input', () => clearRuleFormError());
}

export function openRuleEditor(id) {
  const rule = getScopedRules().find((candidate) => candidate.id === id);
  if (!rule) {
    showStatus('headerStatus', 'That rule is no longer in the active profile.', 'error');
    return;
  }

  state.headers.editingId = id;
  clearRuleFormError();
  siteAccessPreflight.hide();
  document.getElementById('domain').value = rule.domain;
  document.getElementById('headerName').value = rule.headerName;
  document.getElementById('headerValue').value = rule.headerValue;
  document.getElementById('pathPrefix').value = rule.pathPrefix || '';
  document.getElementById('resourceType').value = rule.resourceType || 'all';
  document.getElementById('requestScopeDetails').open = Boolean(rule.pathPrefix) || rule.resourceType === 'xmlhttprequest';
  configureComposer();
  setHeaderComposerExpanded(true, { focusFirstField: true });
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  const addButton = document.getElementById('addHeaderBtn');
  if (addButton.disabled) {
    return;
  }

  addButton.disabled = true;
  addButton.textContent = state.headers.editingId ? 'Updating…' : 'Adding…';

  try {
    const saved = state.headers.editingId
      ? await saveEditedRule(state.headers.editingId)
      : await addRule();
    if (saved) {
      setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
    }
  } finally {
    addButton.disabled = false;
    configureComposer();
  }
}

function handleComposerKeydown(event) {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
}

function toggleHeaderComposer() {
  if (state.headers.composerOpen) {
    setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
    return;
  }

  openCreateComposer();
}

function cancelHeaderComposer() {
  setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
}

export function openCreateComposer() {
  clearRuleFormError();
  state.headers.editingId = null;
  siteAccessPreflight.hide();
  clearHeaderForm();
  configureComposer();
  setHeaderComposerExpanded(true, { focusFirstField: true });
}

export function setHeaderComposerExpanded(expanded, {
  focusFirstField = false,
  reset = false,
  returnFocus = false
} = {}) {
  const composer = document.getElementById('headerComposer');
  const toggle = document.getElementById('headerComposerToggle');

  state.headers.composerOpen = expanded;
  composer.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.disabled = expanded || !state.headers.currentHostname;

  if (reset) {
    clearRuleFormError();
    state.headers.editingId = null;
    siteAccessPreflight.hide();
    clearHeaderForm();
    configureComposer();
  }

  if (focusFirstField && expanded) {
    const domainInput = document.getElementById('domain');
    const firstField = domainInput.value.trim()
      ? document.getElementById('headerName')
      : domainInput;
    composer.scrollTop = 0;
    firstField.focus({ preventScroll: true });
  } else if (returnFocus && !expanded) {
    toggle.focus();
  }
}

export function configureComposer() {
  const editing = Boolean(state.headers.editingId);
  siteAccessPreflight.syncSubmitLabel(editing ? 'Update rule' : 'Add rule');
}

export function readCreateDraft() {
  return {
    domain: document.getElementById('domain').value,
    headerName: document.getElementById('headerName').value,
    headerValue: document.getElementById('headerValue').value,
    pathPrefix: document.getElementById('pathPrefix').value,
    resourceType: document.getElementById('resourceType').value
  };
}

function clearHeaderForm() {
  document.getElementById('domain').value = state.headers.currentHostname;
  document.getElementById('headerName').value = '';
  document.getElementById('headerValue').value = '';
  document.getElementById('pathPrefix').value = '';
  document.getElementById('resourceType').value = 'all';
  document.getElementById('requestScopeDetails').open = false;
}
