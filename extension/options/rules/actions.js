import { getRuleOriginPattern } from '../../shared/domain/rules.js';
import { resolveProfileId } from '../../shared/domain/profiles.js';
import { createRuleWorkflows } from '../../shared/runtime/rule-workflows.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { clearRuleFormError, showRuleFormError } from '../../shared/ui/rule-form-errors.js';
import { state, getActivation } from '../state.js';
import { showStatus } from '../../shared/ui/ui.js';
import { siteAccessPreflight, readCreateDraft, readEditDraft } from './composer.js';

let renderWorkspace;
let ruleWorkflows;

export function configureRuleActions({ onRender, onRefresh }) {
  renderWorkspace = onRender;
  ruleWorkflows = createRuleWorkflows({ refreshState: onRefresh });
}

export async function grantRuleAccess(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  try {
    state.grantedOrigins = await ruleWorkflows.grantAccess(rule, state.grantedOrigins);
    renderWorkspace();
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

export async function addRule() {
  clearRuleFormError();
  const change = ruleWorkflows.prepareAdd(readCreateDraft(), getRuleContext());
  if (!change.ok) {
    showRuleFormError(change);
    return false;
  }

  const { rule: newRule, needsAccess } = change;
  if (needsAccess && !siteAccessPreflight.isReadyFor(newRule)) {
    siteAccessPreflight.show(newRule);
    return false;
  }

  try {
    const { permission, grantedOrigins } = await ruleWorkflows.save(change);
    if (permission) {
      state.grantedOrigins = grantedOrigins;

      if (!permission.granted) {
        if (permission.permissionError) {
          console.error('Could not request site access.', permission.permissionError);
        }
        renderWorkspace();
        showStatus(
          'headerStatus',
          `Rule saved, but HeaderKit still needs site access to https://${newRule.domain} before it can be applied.`,
          'error'
        );
        return true;
      }
    }

    showStatus('headerStatus', needsAccess ? 'Site access granted and rule added.' : 'Header rule added.', 'success');
    return true;
  } catch (error) {
    console.error(error);
    const message = error.message || 'Chrome rejected the new rule.';
    if (!showRuleFormError({ field: error.field, error: message })) {
      showStatus('headerStatus', message, 'error');
    }
    return false;
  }
}

export async function toggleRule(id) {
  const currentRule = state.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    return;
  }

  const change = ruleWorkflows.prepareToggle(currentRule, getRuleContext());
  if (!change.ok) {
    showStatus('headerStatus', change.error, 'error');
    return;
  }

  try {
    const { permission, grantedOrigins } = await ruleWorkflows.save(change);
    if (permission) {
      state.grantedOrigins = grantedOrigins;
      renderWorkspace();
      if (!permission.granted) {
        if (permission.permissionError) {
          console.error('Could not request site access.', permission.permissionError);
        }
        showStatus(
          'headerStatus',
          `Rule resumed, but HeaderKit still needs site access to https://${currentRule.domain} before it can be applied.`,
          'error'
        );
        return;
      }
    }
    const toggledRule = state.rules.find((rule) => rule.id === id);
    showStatus('headerStatus', toggledRule?.enabled ? 'Rule resumed.' : 'Rule paused.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not toggle that rule.', 'error');
  }
}

function reviewEditSiteAccess(id, rule) {
  const preflight = document.getElementById(`editSiteAccessPreflight-${id}`);
  const origin = getRuleOriginPattern(rule);
  if (!preflight.hidden && preflight.dataset.origin === origin) {
    return true;
  }
  preflight.dataset.origin = origin;
  document.getElementById(`editSiteAccessPreflightHost-${id}`).textContent = rule.domain;
  preflight.hidden = false;
  preflight.scrollIntoView({ block: 'nearest' });
  return false;
}

export async function saveEditedRule(id) {
  const currentRule = state.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    state.editingId = null;
    renderWorkspace();
    showStatus('headerStatus', 'That rule no longer exists.', 'error');
    return;
  }

  const draft = readEditDraft(id);
  clearRuleFormError(id);
  const nextProfileId = resolveProfileId(draft.profileId ?? currentRule.profileId);
  const change = ruleWorkflows.prepareUpdate(currentRule, draft, getRuleContext(), nextProfileId);
  if (!change.ok) {
    showRuleFormError(change, id);
    return;
  }

  const { rule: updatedRule, needsAccess } = change;
  if (needsAccess && !reviewEditSiteAccess(id, updatedRule)) {
    return;
  }

  try {
    const { permission: permissionResult, grantedOrigins } = await ruleWorkflows.save(change);
    if (permissionResult) {
      state.grantedOrigins = grantedOrigins;
      renderWorkspace();
    }
    state.editingId = null;
    state.revealedRuleIds.delete(id);
    renderWorkspace();
    if (permissionResult?.permissionError) {
      console.error('Could not request site access.', permissionResult.permissionError);
    }
    if (permissionResult && !permissionResult.granted) {
      showStatus(
        'headerStatus',
        `Rule saved, but HeaderKit still needs site access to https://${updatedRule.domain} before it can be applied.`,
        'error'
      );
      return;
    }
    showStatus('headerStatus', 'Header rule updated.', 'success');
  } catch (error) {
    console.error(error);
    if (!state.rules.some((rule) => rule.id === id)) {
      showStatus('headerStatus', error.message || 'That rule no longer exists.', 'error');
      return;
    }
    const message = error.message || 'Could not update that rule.';
    if (!showRuleFormError({ field: error.field, error: message }, id)) {
      showStatus('headerStatus', message, 'error');
    }
  }
}

export async function confirmDeleteRule(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  const confirmed = await confirmDestructiveAction({
    title: `Delete ${rule.headerName}?`,
    message: getDeleteMessage(rule),
    confirmLabel: 'Delete rule'
  });
  if (confirmed) {
    await deleteRule(id);
  }
}

function getDeleteMessage(rule) {
  const releasesAccess = ruleWorkflows.willReleaseHostAccess(rule, getRuleContext());
  return `The rule for ${rule.domain} will be permanently removed.${
    releasesAccess
      ? ' This is the last rule for this host, so its host-specific site access grant will also be removed.'
      : ''
  }`;
}

async function deleteRule(id) {
  if (!state.rules.some((rule) => rule.id === id)) {
    return;
  }

  try {
    await ruleWorkflows.remove(id);
    state.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Rule removed.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not remove that rule.', 'error');
  }
}

function getRuleContext() {
  return { rules: state.rules, activation: getActivation(), grantedOrigins: state.grantedOrigins };
}
