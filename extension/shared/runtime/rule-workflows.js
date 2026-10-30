import { getTargetProfileId } from '../domain/activation.js';
import {
  findActiveRuleConflict,
  getRuleConflictMessage,
  getRuleOriginPattern,
  validateRuleDraft
} from '../domain/rules.js';
import { isRuleGranted } from '../domain/site-access.js';
import { requestOriginPermission } from './chrome-api.js';
import { RULE_MESSAGE_ADD, RULE_MESSAGE_UPDATE, RULE_MESSAGE_SET_ENABLED, RULE_MESSAGE_DELETE } from './messages.js';
import { sendRuleIntent } from './rule-api.js';
import { readGrantedOrigins, ensureRulePermission } from './site-access-api.js';
import { saveRuleBeforePermissionPrompt } from './site-access-save.js';

/**
 * Prepare changes synchronously from an explicit snapshot. Pages own preflight,
 * form errors, rendering, and edit cleanup; the worker still owns durable state.
 * Each instance keeps its own refresh callback and injectable runtime adapters.
 */
export function createRuleWorkflows({
  refreshState,
  sendIntent = sendRuleIntent,
  requestPermission = requestOriginPermission,
  readOrigins = readGrantedOrigins,
  ensurePermission = ensureRulePermission
}) {
  async function persist(intent) {
    await sendIntent(intent);
    await refreshState();
  }

  async function save(change) {
    if (!change.needsAccess) {
      await persist(change.intent);
      return { permission: null };
    }

    // Do not await anything before this call: the save and permission request
    // must both start in the click's task, even if the popup is then dismissed.
    const permission = await saveRuleBeforePermissionPrompt(change.rule, () => persist(change.intent), {
      requestPermission
    });
    return { permission, grantedOrigins: await readOrigins() };
  }

  function remove(id) {
    return persist({ type: RULE_MESSAGE_DELETE, id });
  }

  return {
    prepareAdd,
    prepareUpdate,
    prepareToggle,
    willReleaseHostAccess,
    save,
    remove,
    grantAccess: ensurePermission
  };
}

function prepareAdd(draft, { rules, activation, grantedOrigins }) {
  const profileId = getTargetProfileId(activation);
  const validation = validateRuleDraft(draft, rules, { activation, profileId });
  if (!validation.ok) {
    return validation;
  }
  return prepareChange(
    { ...validation.rule, enabled: true, profileId },
    { type: RULE_MESSAGE_ADD, draft: validation.rule, profileId },
    grantedOrigins
  );
}

function prepareUpdate(rule, draft, { rules, activation, grantedOrigins }, profileId = rule.profileId) {
  const validation = validateRuleDraft(draft, rules, {
    excludeId: rule.id,
    enabled: rule.enabled,
    activation,
    profileId
  });
  if (!validation.ok) {
    return validation;
  }
  return prepareChange(
    { ...rule, ...validation.rule, profileId },
    { type: RULE_MESSAGE_UPDATE, id: rule.id, draft: validation.rule, profileId },
    grantedOrigins
  );
}

function prepareToggle(rule, { rules, activation, grantedOrigins }) {
  const toggledRule = { ...rule, enabled: !rule.enabled };
  if (toggledRule.enabled) {
    const conflict = findActiveRuleConflict(toggledRule, rules, { excludeId: rule.id, activation });
    if (conflict) {
      return { ok: false, error: getRuleConflictMessage(conflict), conflictId: conflict.id };
    }
  }
  return prepareChange(
    toggledRule,
    { type: RULE_MESSAGE_SET_ENABLED, id: rule.id, enabled: toggledRule.enabled },
    grantedOrigins
  );
}

function prepareChange(rule, intent, grantedOrigins) {
  return { ok: true, rule, intent, needsAccess: rule.enabled && !isRuleGranted(rule, grantedOrigins) };
}

function willReleaseHostAccess(rule, { rules, grantedOrigins }) {
  return (
    Boolean(grantedOrigins?.has(getRuleOriginPattern(rule))) &&
    !rules.some((candidate) => candidate.id !== rule.id && candidate.domain === rule.domain)
  );
}
