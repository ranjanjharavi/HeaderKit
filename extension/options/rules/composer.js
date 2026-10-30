import { createSiteAccessPreflight } from '../../shared/ui/site-access-preflight.js';
import { clearRuleFormError } from '../../shared/ui/rule-form-errors.js';
import { bindHeaderValueFields, syncHeaderValueField } from '../../shared/ui/header-value.js';
import { state } from '../state.js';
import { syncAddRuleActions } from './view.js';

export const siteAccessPreflight = {};
let addRule;

export function bindComposerEvents({ onAddRule }) {
  addRule = onAddRule;
  Object.assign(siteAccessPreflight, createSiteAccessPreflight());
  document.getElementById('headerComposerToggle').addEventListener('click', toggleHeaderComposer);
  document.getElementById('cancelHeaderComposerBtn').addEventListener('click', cancelHeaderComposer);
  const form = document.getElementById('headerComposerForm');
  bindHeaderValueFields(form);
  form.addEventListener('submit', handleComposerSubmit);
  form.addEventListener('keydown', handleComposerKeydown);
  form.addEventListener('input', () => clearRuleFormError());
}

async function handleComposerSubmit(event) {
  event.preventDefault();
  const addButton = document.getElementById('addHeaderBtn');
  if (addButton.disabled) {
    return;
  }

  addButton.disabled = true;
  addButton.textContent = 'Adding…';

  try {
    if (await addRule()) {
      setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
    }
  } finally {
    addButton.disabled = false;
    siteAccessPreflight.syncSubmitLabel('Add rule');
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
  setHeaderComposerExpanded(!state.composerOpen, { focusFirstField: !state.composerOpen });
}

function cancelHeaderComposer() {
  setHeaderComposerExpanded(false, { reset: true, returnFocus: true });
}

export function setHeaderComposerExpanded(
  expanded,
  { focusFirstField = false, reset = false, returnFocus = false } = {}
) {
  const composer = document.getElementById('headerComposer');
  const toggle = document.getElementById('headerComposerToggle');

  state.composerOpen = expanded;
  if (expanded) {
    state.editingId = null;
  }
  composer.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  syncAddRuleActions();

  if (reset) {
    clearRuleFormError();
    siteAccessPreflight.hide();
    clearHeaderForm();
  }

  if (focusFirstField && expanded) {
    document.getElementById('domain').focus();
  } else if (returnFocus && !expanded) {
    toggle.focus();
  }
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

export function readEditDraft(id) {
  return {
    domain: document.getElementById(`editDomain-${id}`).value,
    headerName: document.getElementById(`editHeaderName-${id}`).value,
    headerValue: document.getElementById(`editHeaderValue-${id}`).value,
    pathPrefix: document.getElementById(`editPathPrefix-${id}`).value,
    resourceType: document.getElementById(`editResourceType-${id}`).value,
    profileId: document.getElementById(`editProfile-${id}`)?.value
  };
}

function clearHeaderForm() {
  document.getElementById('domain').value = '';
  document.getElementById('headerName').value = '';
  document.getElementById('headerValue').value = '';
  document.getElementById('pathPrefix').value = '';
  document.getElementById('resourceType').value = 'all';
  document.getElementById('requestScopeDetails').open = false;
  syncHeaderValueField(document.getElementById('headerComposerForm'));
}
