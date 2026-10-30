import { getNextRuleId, getRuleIdentityKey, normalizeRules, validateRuleDraft } from '../shared/domain/rules.js';
import {
  RULE_MESSAGE_ADD,
  RULE_MESSAGE_UPDATE,
  RULE_MESSAGE_SET_ENABLED,
  RULE_MESSAGE_DELETE
} from '../shared/runtime/messages.js';

export function applyRuleIntent(message, { rules, activation, profileIds }) {
  const existingRule = message.type === RULE_MESSAGE_ADD ? null : rules.find((rule) => rule.id === message.id);
  if (message.type !== RULE_MESSAGE_ADD && !existingRule) {
    throw new Error('That rule no longer exists. Refresh and try again.');
  }
  if (message.type === RULE_MESSAGE_DELETE) {
    return { rules: rules.filter((rule) => rule.id !== message.id) };
  }
  if (![RULE_MESSAGE_ADD, RULE_MESSAGE_UPDATE, RULE_MESSAGE_SET_ENABLED].includes(message.type)) {
    throw new Error('Unknown header rule request.');
  }

  let profileId = existingRule?.profileId;
  if (message.type !== RULE_MESSAGE_SET_ENABLED) {
    profileId = message.profileId ?? profileId;
  }
  if (!profileIds.has(profileId)) {
    throw new Error('That profile no longer exists.');
  }
  let enabled = existingRule?.enabled ?? true;
  if (message.type === RULE_MESSAGE_SET_ENABLED) {
    if (typeof message.enabled !== 'boolean') {
      throw new TypeError('Choose whether the rule is enabled.');
    }
    enabled = message.enabled;
  }

  const draft = message.type === RULE_MESSAGE_SET_ENABLED ? existingRule : message.draft;
  const validation = validateRuleDraft(draft, rules, {
    excludeId: existingRule?.id ?? null,
    enabled,
    activation,
    profileId
  });
  if (!validation.ok) {
    throw Object.assign(new Error(validation.error), {
      field: validation.field,
      conflictId: validation.conflictId
    });
  }

  const rule = {
    ...validation.rule,
    id: existingRule?.id ?? getNextRuleId(rules),
    enabled,
    profileId
  };
  let nextRules = [...rules, rule];
  if (existingRule) {
    nextRules = rules.map((currentRule) => (currentRule.id === rule.id ? rule : currentRule));
  }
  return { rules: nextRules, rule };
}

export async function commitRuleSet(nextRules, { profileIds = null, getCurrentRules, applyRules, storeRules }) {
  if (!Array.isArray(nextRules)) {
    throw new TypeError('Header rules must be an array.');
  }
  if (profileIds && nextRules.some((rule) => rule?.profileId && !profileIds.has(rule.profileId))) {
    throw new Error('That profile no longer exists.');
  }

  const normalizedRules = normalizeRules(nextRules, { profileIds });
  if (normalizedRules.length !== nextRules.length) {
    throw new Error('One or more header rules are invalid.');
  }

  const identities = new Set();
  const duplicateRule = normalizedRules.find((rule) => {
    const identity = getRuleIdentityKey(rule);
    if (identities.has(identity)) {
      return true;
    }
    identities.add(identity);
    return false;
  });
  if (duplicateRule) {
    throw new Error(
      `${duplicateRule.headerName} already exists for ${duplicateRule.domain} with that request scope in this profile.`
    );
  }

  const previousRules = await getCurrentRules();
  await applyRules(normalizedRules);

  try {
    await storeRules(normalizedRules);
  } catch (error) {
    try {
      await applyRules(previousRules);
    } catch (rollbackError) {
      console.error('Could not restore the previous dynamic rules.', rollbackError);
    }
    throw error;
  }

  return normalizedRules;
}
