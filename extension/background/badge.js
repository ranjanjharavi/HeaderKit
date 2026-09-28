import { countLiveRules, getTargetProfileId } from '../shared/domain/activation.js';
import { normalizeDomain } from '../shared/domain/rules.js';

export const BADGE_ACTIVE_COLOR = '#2563eb';
export const BADGE_PAUSED_COLOR = '#64748b';

/**
 * The badge answers one question: is ReqKit changing requests here, right now?
 *
 * `url` is `undefined` when the tab's address cannot be read — Chrome only
 * exposes it for hosts the extension holds permission for, which is exactly the
 * set of hosts that have rules. An unreadable tab falls back to the profile-wide
 * count rather than claiming something specific about that page.
 */
export function resolveBadge(rules, activation, { url } = {}) {
  const scopedRules = scopeRules(rules, url);
  if (scopedRules === null) {
    return { text: '', color: null };
  }

  const liveCount = countLiveRules(scopedRules, activation);
  if (liveCount > 0) {
    return { text: String(liveCount), color: BADGE_ACTIVE_COLOR };
  }

  // Distinguish "nothing to apply" from "something is being held back", so the
  // paused state is visible but an empty profile stays quiet.
  const heldBackCount = countLiveRules(scopedRules, {
    masterEnabled: true,
    profileId: getTargetProfileId(activation)
  });

  return heldBackCount > 0
    ? { text: 'off', color: BADGE_PAUSED_COLOR }
    : { text: '', color: null };
}

/**
 * Returns the rules the badge should count, or `null` when the tab is a page
 * ReqKit can never act on.
 */
function scopeRules(rules, url) {
  const allRules = Array.isArray(rules) ? rules : [];
  if (url === undefined || url === null) {
    return allRules;
  }

  const hostname = normalizeDomain(url);
  if (!hostname) {
    return null;
  }

  return allRules.filter((rule) => rule.domain === hostname);
}
