import {
  findActiveRuleConflict,
  getNextRuleId,
  getRuleOriginPattern,
  getRuleConflictMessage,
  validateRuleDraft
} from '../../shared/domain/rules.js';
import { requestOriginPermission } from '../../shared/runtime/chrome-api.js';
import { getTargetProfileId } from '../../shared/domain/activation.js';
import { resolveProfileId } from '../../shared/domain/profiles.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import { saveRuleBeforePermissionPrompt } from '../../shared/runtime/site-access-save.js';
import { commitRules } from '../../shared/runtime/rule-api.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { clearRuleFormError, showRuleFormError } from '../../shared/ui/rule-form-errors.js';
import { state, getActivation } from '../state.js';
import {
  readGrantedOrigins,
  ensureRulePermission,
  releaseUnusedPermission
} from '../../shared/runtime/site-access-api.js';
import { showStatus } from '../../shared/ui/ui.js';
import { siteAccessPreflight, readCreateDraft, readEditDraft } from './composer.js';

let renderWorkspace;

export function configureRuleActions({ onRender }) {
  renderWorkspace = onRender;
}

export async function grantRuleAccess(id) {
  const rule = state.rules.find((candidate) => candidate.id === id);
  if (!rule) {
    return;
  }

  try {
    state.grantedOrigins = await ensureRulePermission(rule, state.grantedOrigins);
    await persistRules(state.rules);
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

export async function addRule() {
  clearRuleFormError();
  const activation = getActivation();
  // New rules belong to the selected profile, which is also the profile shown
  // in the manager's rule list.
  const profileId = getTargetProfileId(activation);
  const validation = validateRuleDraft(readCreateDraft(), state.rules, { activation, profileId });
  if (!validation.ok) {
    showRuleFormError(validation);
    return false;
  }

  const newRule = {
    id: getNextRuleId(state.rules),
    ...validation.rule,
    enabled: true,
    profileId
  };

  const needsAccess = !isRuleGranted(newRule, state.grantedOrigins);
  if (needsAccess && !siteAccessPreflight.isReadyFor(newRule)) {
    siteAccessPreflight.show(newRule);
    return false;
  }

  try {
    const updatedRules = [...state.rules, newRule];
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(newRule, updatedRules, {
        persistRules,
        requestPermission: requestOriginPermission
      });
      state.grantedOrigins = await readGrantedOrigins();

      if (!result.granted) {
        if (result.permissionError) {
          console.error('Could not request site access.', result.permissionError);
        }
        renderWorkspace();
        showStatus(
          'headerStatus',
          `Rule saved, but ReqKit still needs site access to https://${newRule.domain} before it can be applied.`,
          'error'
        );
        return true;
      }

      await persistRules(state.rules);
    } else {
      await persistRules(updatedRules);
    }

    showStatus(
      'headerStatus',
      needsAccess ? 'Site access granted and rule added.' : 'Header rule added.',
      'success'
    );
    return true;
  } catch (error) {
    console.error(error);
    showRuleFormError({ error: error.message || 'Chrome rejected the new rule.' });
    return false;
  }
}

export async function toggleRule(id) {
  const currentRule = state.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    return;
  }

  if (!currentRule.enabled) {
    const conflictingRule = findActiveRuleConflict(
      { ...currentRule, enabled: true },
      state.rules,
      { excludeId: id, activation: getActivation() }
    );
    if (conflictingRule) {
      showStatus('headerStatus', getRuleConflictMessage(conflictingRule), 'error');
      return;
    }
  }

  const updatedRules = state.rules.map((rule) => (
    rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
  ));
  const needsAccess = !currentRule.enabled && !isRuleGranted(currentRule, state.grantedOrigins);

  try {
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(currentRule, updatedRules, {
        persistRules,
        requestPermission: requestOriginPermission
      });
      state.grantedOrigins = await readGrantedOrigins();
      renderWorkspace();
      if (!result.granted) {
        if (result.permissionError) {
          console.error('Could not request site access.', result.permissionError);
        }
        showStatus(
          'headerStatus',
          `Rule resumed, but ReqKit still needs site access to https://${currentRule.domain} before it can be applied.`,
          'error'
        );
        return;
      }
    } else {
      await persistRules(updatedRules);
    }
    const toggledRule = state.rules.find((rule) => rule.id === id);
    showStatus('headerStatus', toggledRule?.enabled ? 'Rule resumed.' : 'Rule paused.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not toggle that rule.', 'error');
  }
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
  const validation = validateRuleDraft(draft, state.rules, {
    excludeId: id,
    enabled: currentRule.enabled,
    activation: getActivation(),
    profileId: nextProfileId
  });
  if (!validation.ok) {
    showRuleFormError(validation, id);
    return;
  }

  const updatedRules = state.rules.map((rule) => (
    rule.id === id ? { ...rule, ...validation.rule, profileId: nextProfileId } : rule
  ));
  const updatedRule = updatedRules.find((rule) => rule.id === id);
  const needsAccess = updatedRule.enabled && !isRuleGranted(updatedRule, state.grantedOrigins);
  if (needsAccess) {
    const preflight = document.getElementById(`editSiteAccessPreflight-${id}`);
    const origin = getRuleOriginPattern(updatedRule);
    if (preflight.hidden || preflight.dataset.origin !== origin) {
      preflight.dataset.origin = origin;
      document.getElementById(`editSiteAccessPreflightHost-${id}`).textContent = updatedRule.domain;
      preflight.hidden = false;
      preflight.scrollIntoView({ block: 'nearest' });
      return;
    }
  }

  try {
    state.editingId = null;
    state.revealedRuleIds.delete(id);
    let permissionResult = null;
    if (needsAccess) {
      permissionResult = await saveRuleBeforePermissionPrompt(updatedRule, updatedRules, {
        persistRules,
        requestPermission: requestOriginPermission
      });
      state.grantedOrigins = await readGrantedOrigins();
      renderWorkspace();
    } else {
      await persistRules(updatedRules);
    }
    if (currentRule.domain !== updatedRule.domain) {
      await releaseUnusedPermission(currentRule, updatedRules);
    }
    if (permissionResult && !permissionResult.granted) {
      if (permissionResult.permissionError) {
        console.error('Could not request site access.', permissionResult.permissionError);
      }
      showStatus(
        'headerStatus',
        `Rule saved, but ReqKit still needs site access to https://${updatedRule.domain} before it can be applied.`,
        'error'
      );
      return;
    }
    showStatus('headerStatus', 'Header rule updated.', 'success');
  } catch (error) {
    state.editingId = id;
    console.error(error);
    showRuleFormError({ error: error.message || 'Could not update that rule.' }, id);
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
  const releasesAccess = state.grantedOrigins?.has(getRuleOriginPattern(rule))
    && !state.rules.some((candidate) => candidate.id !== rule.id && candidate.domain === rule.domain);
  return `The rule for ${rule.domain} will be permanently removed.${releasesAccess
    ? ' This is the last rule for this host, so its host-specific site access grant will also be removed.'
    : ''}`;
}

async function deleteRule(id) {
  const ruleToDelete = state.rules.find((rule) => rule.id === id);
  if (!ruleToDelete) {
    return;
  }

  try {
    const updatedRules = state.rules.filter((rule) => rule.id !== id);
    await persistRules(updatedRules);
    await releaseUnusedPermission(ruleToDelete, updatedRules);
    state.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Rule removed.', 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not remove that rule.', 'error');
  }
}

/**
 * The storage listener would otherwise fire on this page's own write and close
 * an open edit form underneath the user.
 */
async function persistRules(rules) {
  state.syncPaused = true;
  try {
    state.rules = await commitRules(rules);
    renderWorkspace();
  } finally {
    state.syncPaused = false;
  }
}
