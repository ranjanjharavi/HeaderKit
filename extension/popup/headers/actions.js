import {
  findActiveRuleConflict,
  getRuleOriginPattern,
  getRuleConflictMessage,
  validateRuleDraft
} from '../../shared/domain/rules.js';
import { requestOriginPermission } from '../../shared/runtime/chrome-api.js';
import { getTargetProfileId } from '../../shared/domain/activation.js';
import { isRuleGranted } from '../../shared/domain/site-access.js';
import { saveRuleBeforePermissionPrompt } from '../../shared/runtime/site-access-save.js';
import { sendRuleIntent } from '../../shared/runtime/rule-api.js';
import { RULE_MESSAGE_ADD, RULE_MESSAGE_UPDATE, RULE_MESSAGE_SET_ENABLED, RULE_MESSAGE_DELETE } from '../../shared/runtime/messages.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { clearRuleFormError, showRuleFormError } from '../../shared/ui/rule-form-errors.js';
import { state, getActivation } from '../state.js';
import {
  readGrantedOrigins,
  ensureRulePermission
} from '../../shared/runtime/site-access-api.js';
import { showStatus } from '../../shared/ui/ui.js';
import { siteAccessPreflight, readCreateDraft } from './composer.js';
import { renderRules } from './view.js';

let refreshState;

export function configureRuleActions({ onRefresh }) {
  refreshState = onRefresh;
}

export async function addRule() {
  clearRuleFormError();
  const activation = getActivation();
  const profileId = getTargetProfileId(activation);
  const validation = validateRuleDraft(readCreateDraft(), state.headers.rules, {
    activation,
    profileId
  });
  if (!validation.ok) {
    showRuleFormError(validation);
    return false;
  }

  const newRule = {
    ...validation.rule,
    enabled: true,
    profileId
  };
  const intent = { type: RULE_MESSAGE_ADD, draft: validation.rule, profileId };

  const needsAccess = !isRuleGranted(newRule, state.headers.grantedOrigins);
  if (needsAccess && !siteAccessPreflight.isReadyFor(newRule)) {
    siteAccessPreflight.show(newRule);
    return false;
  }

  try {
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(newRule, () => persistRule(intent), {
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

    } else {
      await persistRule(intent);
    }

    showStatus(
      'headerStatus',
      needsAccess ? 'Site access granted and rule added.' : 'Header rule added.',
      'success'
    );
    return true;
  } catch (error) {
    console.error(error);
    showRuleFormError({ field: error.field, error: error.message || 'Chrome rejected the new rule.' });
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

  const profileId = currentRule.profileId;
  const validation = validateRuleDraft(readCreateDraft(), state.headers.rules, {
    excludeId: id,
    enabled: currentRule.enabled,
    activation: getActivation(),
    profileId
  });
  if (!validation.ok) {
    showRuleFormError(validation);
    return false;
  }

  const updatedRule = { ...currentRule, ...validation.rule, profileId };
  const intent = { type: RULE_MESSAGE_UPDATE, id, draft: validation.rule, profileId };
  const needsAccess = updatedRule.enabled && !isRuleGranted(updatedRule, state.headers.grantedOrigins);
  if (needsAccess && !siteAccessPreflight.isReadyFor(updatedRule)) {
    siteAccessPreflight.show(updatedRule);
    return false;
  }

  try {
    let permissionResult = null;
    if (needsAccess) {
      permissionResult = await saveRuleBeforePermissionPrompt(updatedRule, () => persistRule(intent), {
        requestPermission: requestOriginPermission
      });
      state.headers.grantedOrigins = await readGrantedOrigins();
    } else {
      await persistRule(intent);
    }
    state.headers.revealedRuleIds.delete(id);
    renderRules();
    if (permissionResult && !permissionResult.granted) {
      if (permissionResult.permissionError) {
        console.error('Could not request site access.', permissionResult.permissionError);
      }
      showStatus(
        'headerStatus',
        `Rule saved, but ReqKit still needs site access to https://${updatedRule.domain} before it can be applied.`,
        'error'
      );
      return true;
    }
    showStatus('headerStatus', 'Header rule updated.', 'success');
    return true;
  } catch (error) {
    console.error(error);
    showRuleFormError({ field: error.field, error: error.message || 'Could not update that rule.' });
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
  }

  const intent = { type: RULE_MESSAGE_SET_ENABLED, id, enabled: !currentRule.enabled };
  const needsAccess = !currentRule.enabled && !isRuleGranted(currentRule, state.headers.grantedOrigins);

  try {
    if (needsAccess) {
      const result = await saveRuleBeforePermissionPrompt(currentRule, () => persistRule(intent), {
        requestPermission: requestOriginPermission
      });
      state.headers.grantedOrigins = await readGrantedOrigins();
      renderRules();
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
      await persistRule(intent);
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
  const releasesAccess = state.headers.grantedOrigins?.has(getRuleOriginPattern(rule))
    && !state.headers.rules.some((candidate) => candidate.id !== rule.id && candidate.domain === rule.domain);
  return `The rule for ${rule.domain} will be permanently removed.${releasesAccess
    ? ' This is the last rule for this host, so its host-specific site access grant will also be removed.'
    : ''}`;
}

async function deleteRule(id) {
  if (!state.headers.rules.some((rule) => rule.id === id)) {
    return;
  }

  try {
    await persistRule({ type: RULE_MESSAGE_DELETE, id });
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
    state.headers.grantedOrigins = await ensureRulePermission(rule, state.headers.grantedOrigins);
    renderRules();
    showStatus('headerStatus', `Site access granted for ${rule.domain}.`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Chrome did not grant site access.', 'error');
  }
}

async function persistRule(intent) {
  await sendRuleIntent(intent);
  await refreshState();
}
