import {
  findActiveRuleConflict,
  getNextRuleId,
  getRuleConflictMessage,
  validateRuleDraft
} from '../../shared/domain/rules.js';
import { requestOriginPermission } from '../../shared/runtime/chrome-api.js';
import { getTargetProfileId } from '../../shared/domain/activation.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import { saveRuleBeforePermissionPrompt } from '../../shared/runtime/site-access-save.js';
import { commitRules } from '../../shared/runtime/rule-api.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { state, getActivation } from '../state.js';
import {
  readGrantedOrigins,
  ensureRulePermission,
  releaseUnusedPermission
} from '../../shared/runtime/site-access-api.js';
import { showStatus } from '../../shared/ui/ui.js';
import { siteAccessPreflight, readCreateDraft } from './composer.js';
import { renderRules } from './view.js';

export async function addRule() {
  const activation = getActivation();
  const profileId = getTargetProfileId(activation);
  const validation = validateRuleDraft(readCreateDraft(), state.headers.rules, {
    activation,
    profileId
  });
  if (!validation.ok) {
    showStatus('headerStatus', validation.error, 'error');
    return false;
  }

  const newRule = {
    id: getNextRuleId(state.headers.rules),
    ...validation.rule,
    enabled: true,
    profileId
  };
  const updatedRules = [
    ...state.headers.rules,
    newRule
  ];

  const needsAccess = !isRuleGranted(newRule, state.headers.grantedOrigins);
  if (needsAccess && !siteAccessPreflight.isReadyFor(newRule)) {
    siteAccessPreflight.show(newRule);
    return false;
  }

  try {
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(newRule, updatedRules, {
        persistRules,
        requestPermission: requestOriginPermission
      });
      state.headers.grantedOrigins = await readGrantedOrigins();

      if (!result.granted) {
        if (result.permissionError) {
          console.error('Could not request site access.', result.permissionError);
        }
        renderRules();
        showStatus(
          'headerStatus',
          `Rule saved, but ReqKit still needs site access to https://${newRule.domain} before it can be applied.`,
          'error'
        );
        return true;
      }

      // Re-commit with the refreshed grant list when the popup remains open.
      // The background permission listener covers the popup-close case.
      await persistRules(state.headers.rules);
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
    showStatus('headerStatus', error.message || 'Chrome rejected the new rule.', 'error');
    return false;
  }
}

export async function saveEditedRule(id) {
  const currentRule = state.headers.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    showStatus('headerStatus', 'That rule no longer exists.', 'error');
    return false;
  }

  const profileId = getTargetProfileId(getActivation());
  const validation = validateRuleDraft(readCreateDraft(), state.headers.rules, {
    excludeId: id,
    enabled: currentRule.enabled,
    activation: getActivation(),
    profileId
  });
  if (!validation.ok) {
    showStatus('headerStatus', validation.error, 'error');
    return false;
  }

  const updatedRules = state.headers.rules.map((rule) => (
    rule.id === id ? { ...rule, ...validation.rule, profileId } : rule
  ));
  const updatedRule = updatedRules.find((rule) => rule.id === id);

  try {
    if (updatedRule.enabled) {
      await ensureRulePermission(updatedRule);
    }
    await persistRules(updatedRules);
    if (currentRule.domain !== updatedRule.domain) {
      await releaseUnusedPermission(currentRule, updatedRules);
    }
    state.headers.revealedRuleIds.delete(id);
    showStatus('headerStatus', 'Header rule updated.', 'success');
    return true;
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not update that rule.', 'error');
    return false;
  }
}

export async function toggleRule(id) {
  const currentRule = state.headers.rules.find((rule) => rule.id === id);
  if (!currentRule) {
    return;
  }

  if (!currentRule.enabled) {
    const conflictingRule = findActiveRuleConflict(
      { ...currentRule, enabled: true },
      state.headers.rules,
      { excludeId: id, activation: getActivation() }
    );
    if (conflictingRule) {
      showStatus('headerStatus', getRuleConflictMessage(conflictingRule), 'error');
      return;
    }

    try {
      await ensureRulePermission(currentRule);
    } catch (error) {
      console.error(error);
      showStatus('headerStatus', error.message, 'error');
      return;
    }
  }

  const updatedRules = state.headers.rules.map((rule) => (
    rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
  ));

  try {
    await persistRules(updatedRules);
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
    message: `The rule for ${rule.domain} will be permanently removed.`,
    confirmLabel: 'Delete rule'
  });
  if (confirmed) {
    await deleteRule(id);
  }
}

async function deleteRule(id) {
  const ruleToDelete = state.headers.rules.find((rule) => rule.id === id);
  if (!ruleToDelete) {
    return;
  }

  try {
    const updatedRules = state.headers.rules.filter((rule) => rule.id !== id);
    await persistRules(updatedRules);
    await releaseUnusedPermission(ruleToDelete, updatedRules);
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
    await ensureRulePermission(rule);
    state.headers.grantedOrigins = await readGrantedOrigins();
    // Re-commit so the worker rebuilds the rule set now that access exists.
    await persistRules(state.headers.rules);
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

/**
 * The storage listener would otherwise fire on this page's own write and reset
 * transient UI such as revealed values.
 */
async function persistRules(rules) {
  state.headers.syncPaused = true;
  try {
    state.headers.rules = await commitRules(rules);
    renderRules();
  } finally {
    state.headers.syncPaused = false;
  }
}
