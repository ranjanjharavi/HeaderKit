import { getGrantedOrigins, requestOriginPermission, removeOriginPermission } from './chrome-api.js';
import { getRuleOriginPattern } from '../domain/rules.js';
import { isRuleGranted } from '../domain/site-access.js';

export async function readGrantedOrigins() {
  try {
    return await getGrantedOrigins();
  } catch (error) {
    console.error('Could not read granted site access.', error);
    return null;
  }
}

// Use the page's cached grants before requesting access. Do not await a lookup
// before permissions.request: it must remain attached to the user's gesture.
export async function ensureRulePermission(rule, grantedOrigins) {
  if (isRuleGranted(rule, grantedOrigins)) {
    return grantedOrigins;
  }

  const granted = await requestOriginPermission(getRuleOriginPattern(rule));
  if (!granted) {
    throw new Error(`Site access to https://${rule.domain} is required to resume this rule.`);
  }
  return readGrantedOrigins();
}

export async function releaseUnusedPermission(rule, remainingRules) {
  if (remainingRules.some((candidate) => candidate.domain === rule.domain)) {
    return;
  }

  try {
    await removeOriginPermission(getRuleOriginPattern(rule));
  } catch (error) {
    console.error(`Could not release site access for ${rule.domain}.`, error);
  }
}
