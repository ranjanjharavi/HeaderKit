import { getRuleIdentityKey, normalizeRules } from '../shared/domain/rules.js';

export async function commitRuleSet(nextRules, {
  profileIds = null,
  getCurrentRules,
  applyRules,
  storeRules
}) {
  if (!Array.isArray(nextRules)) {
    throw new Error('Header rules must be an array.');
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
