import { state } from '../state.js';
import { clearRuleFormError } from '../../shared/ui/rule-form-errors.js';
import {
  configureRuleActions,
  grantRuleAccess,
  addRule,
  toggleRule,
  saveEditedRule,
  confirmDeleteRule
} from './actions.js';
import { bindComposerEvents, setHeaderComposerExpanded } from './composer.js';
import { renderRules } from './view.js';

export { renderRules };

let refreshWorkspace;
let renderWorkspace;

export function bindRuleEvents({ onRefresh, onRender }) {
  refreshWorkspace = onRefresh;
  renderWorkspace = onRender;
  configureRuleActions({ onRender });
  bindComposerEvents({ onAddRule: addRule });

  const ruleList = document.getElementById('ruleListContainer');
  ruleList.addEventListener('click', handleRuleListClick);
  ruleList.addEventListener('submit', handleRuleFormSubmit);
  ruleList.addEventListener('keydown', handleRuleFormKeydown);
  ruleList.addEventListener('input', (event) => {
    const form = event.target.closest('.rule-edit-form');
    if (form) {
      clearRuleFormError(Number(form.dataset.id));
      const preflight = document.getElementById(`editSiteAccessPreflight-${form.dataset.id}`);
      preflight.hidden = true;
      preflight.dataset.origin = '';
    }
  });
  document.getElementById('ruleSearchInput').addEventListener('input', handleRuleSearchInput);

}

export async function initializeRules({ editRuleId = null } = {}) {
  await refreshWorkspace();

  if (editRuleId && state.rules.some((rule) => rule.id === editRuleId)) {
    startEditingRule(editRuleId);
    document.querySelector('.rule-edit-form')?.scrollIntoView({ block: 'center' });
  }
}

function handleRuleListClick(event) {
  const button = event.target.closest('[data-rule-action]');
  if (!button) {
    return;
  }

  switch (button.dataset.ruleAction) {
    case 'open-composer':
      setHeaderComposerExpanded(true, { focusFirstField: true });
      break;
    case 'clear-search':
      clearRuleSearch();
      break;
    case 'toggle-domain':
      toggleDomainGroup(button.dataset.domain);
      break;
    case 'edit':
      startEditingRule(Number(button.dataset.id));
      break;
    case 'toggle':
      toggleRule(Number(button.dataset.id));
      break;
    case 'reveal':
      toggleRuleValueVisibility(Number(button.dataset.id));
      break;
    case 'grant':
      grantRuleAccess(Number(button.dataset.id));
      break;
    case 'delete':
      confirmDeleteRule(Number(button.dataset.id));
      break;
    case 'cancel-edit':
      state.editingId = null;
      renderWorkspace();
      break;
    default:
      break;
  }
}

function handleRuleSearchInput(event) {
  state.searchQuery = event.target.value;
  renderWorkspace();
}

async function handleRuleFormSubmit(event) {
  const form = event.target.closest('.rule-edit-form');
  if (!form) {
    return;
  }

  event.preventDefault();
  const id = Number(form.dataset.id);
  const buttons = form.querySelectorAll('button');
  const saveButton = form.querySelector('.save-edit-rule-btn');

  buttons.forEach((button) => {
    button.disabled = true;
  });
  saveButton.textContent = 'Saving…';

  try {
    await saveEditedRule(id);
  } finally {
    if (saveButton.isConnected) {
      buttons.forEach((button) => {
        button.disabled = false;
      });
      saveButton.textContent = 'Save changes';
    }
  }
}

function handleRuleFormKeydown(event) {
  if (event.key !== 'Escape' || !event.target.closest('.rule-edit-form')) {
    return;
  }

  event.preventDefault();
  state.editingId = null;
  renderWorkspace();
}

function toggleDomainGroup(domain) {
  if (!domain) {
    return;
  }

  if (state.collapsedDomains.has(domain)) {
    state.collapsedDomains.delete(domain);
  } else {
    state.collapsedDomains.add(domain);
  }
  renderWorkspace();
}

function startEditingRule(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  setHeaderComposerExpanded(false, { reset: true });
  state.editingId = id;
  state.collapsedDomains.delete(rule.domain);
  renderWorkspace();
  const domainInput = document.getElementById(`editDomain-${id}`);
  domainInput?.focus();
  domainInput?.select();
}

function toggleRuleValueVisibility(id) {
  if (state.revealedRuleIds.has(id)) {
    state.revealedRuleIds.delete(id);
  } else {
    state.revealedRuleIds.add(id);
  }
  renderWorkspace();
}

function clearRuleSearch() {
  state.searchQuery = '';
  const searchInput = document.getElementById('ruleSearchInput');
  searchInput.value = '';
  renderWorkspace();
  searchInput.focus();
}
