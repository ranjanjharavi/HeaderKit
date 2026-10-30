import { createRuleWorkflows } from '../../shared/runtime/rule-workflows.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { clearRuleFormError, showRuleFormError } from '../../shared/ui/rule-form-errors.js';
import { state, getActivation } from '../state.js';
import { showStatus } from '../../shared/ui/ui.js';
import { siteAccessPreflight, readCreateDraft } from './composer.js';

let ruleWorkflows;
let renderWorkspace;

export function configureRuleActions({ onRefresh, onRender }) {
  ruleWorkflows = createRuleWorkflows({ refreshState: onRefresh });
  renderWorkspace = onRender;
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
      state.headers.grantedOrigins = grantedOrigins;

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

export async function saveEditedRule(id) {
  clearRuleFormError();
  const currentRule = state.headers.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    showStatus('headerStatus', 'That rule no longer exists.', 'error');
    return false;
  }

  const change = ruleWorkflows.prepareUpdate(currentRule, readCreateDraft(), getRuleContext());
  if (!change.ok) {
    showRuleFormError(change);
    return false;
  }

  const { rule: updatedRule, needsAccess } = change;
  if (needsAccess && !siteAccessPreflight.isReadyFor(updatedRule)) {
    siteAccessPreflight.show(updatedRule);
    return false;
  }

  try {
    const { permission: permissionResult, grantedOrigins } = await ruleWorkflows.save(change);
    if (permissionResult) {
      state.headers.grantedOrigins = grantedOrigins;
    }
    state.headers.revealedRuleIds.delete(id);
    renderWorkspace();
    if (permissionResult && !permissionResult.granted) {
      if (permissionResult.permissionError) {
        console.error('Could not request site access.', permissionResult.permissionError);
      }
      showStatus(
        'headerStatus',
        `Rule saved, but HeaderKit still needs site access to https://${updatedRule.domain} before it can be applied.`,
        'error'
      );
      return true;
    }
    showStatus('headerStatus', 'Header rule updated.', 'success');
    return true;
  } catch (error) {
    console.error(error);
    const message = error.message || 'Could not update that rule.';
    if (!showRuleFormError({ field: error.field, error: message })) {
      showStatus('headerStatus', message, 'error');
    }
    return false;
  }
}

export async function toggleRule(id) {
  const currentRule = state.headers.rules.find((rule) => rule.id === id);
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
      state.headers.grantedOrigins = grantedOrigins;
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
    const toggledRule = state.headers.rules.find((rule) => rule.id === id);
    showStatus('headerStatus', toggledRule?.enabled ? 'Rule resumed.' : 'Rule paused.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not toggle that rule.', 'error');
  }
}

export async function confirmDeleteRule(id) {
  const rule = state.headers.rules.find((candidate) => candidate.id === id);
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
  if (!state.headers.rules.some((rule) => rule.id === id)) {
    return;
  }

  try {
    await ruleWorkflows.remove(id);
    state.headers.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Rule removed.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not remove that rule.', 'error');
  }
}

export async function grantRuleAccess(id) {
  const rule = state.headers.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  try {
    state.headers.grantedOrigins = await ruleWorkflows.grantAccess(rule, state.headers.grantedOrigins);
    renderWorkspace();
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

function getRuleContext() {
  return { rules: state.headers.rules, activation: getActivation(), grantedOrigins: state.headers.grantedOrigins };
}
