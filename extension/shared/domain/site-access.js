import { filterRulesByProfile, getRuleOriginPattern } from './rules.js';

const BROAD_ORIGIN_PATTERNS = ['https://*/*', '<all_urls>'];

/**
 * Every origin a profile needs in order to apply all of its rules.
 */
export function getProfileOrigins(rules, profileId) {
  return [...new Set(
    filterRulesByProfile(rules, profileId).map((rule) => getRuleOriginPattern(rule))
  )].sort();
}

export function isOriginGranted(origin, grantedOrigins) {
  const granted = grantedOrigins instanceof Set ? grantedOrigins : new Set(grantedOrigins || []);
  return [...granted].some((pattern) => originPatternCovers(pattern, origin));
}

export function getRulesForOriginGrant(rules, origin) {
  const grant = new Set([origin]);
  return (Array.isArray(rules) ? rules : []).filter((rule) => isRuleGranted(rule, grant));
}

export function isBroadOrigin(origin) {
  return BROAD_ORIGIN_PATTERNS.includes(origin) || /^https:\/\/\*\.[^/*]+\/\*$/.test(origin);
}

export function filterOriginGrants(origins, query) {
  const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const grants = Array.isArray(origins) ? origins : [];

  if (!terms.length) {
    return [...grants];
  }

  const requestedOrigin = getHostSearchOrigin(query);
  return grants.filter((origin) => {
    const pattern = String(origin || '');
    const host = /^https:\/\/([^/]+)\/\*$/.exec(pattern)?.[1]?.replace(/^\*\./, '') || '';
    const label = pattern === '<all_urls>'
      ? 'all websites'
      : pattern === 'https://*/*'
        ? 'all https sites'
        : '';
    const searchableText = `${pattern} ${host} ${label}`.toLocaleLowerCase();
    return terms.every((term) => searchableText.includes(term))
      || (requestedOrigin && originPatternCovers(pattern, requestedOrigin));
  });
}

function getHostSearchOrigin(query) {
  const host = String(query || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/\*?$/, '');
  if (!host || /[/?#\s]/.test(host)) {
    return null;
  }

  return `https://${host}/*`;
}

export function isRuleGranted(rule, grantedOrigins) {
  return isOriginGranted(getRuleOriginPattern(rule), grantedOrigins);
}

/**
 * Computed from a cached grant list so the caller can go straight from a click
 * into permissions.request without an await in between.
 */
export function getMissingProfileOrigins(rules, profileId, grantedOrigins) {
  return getProfileOrigins(rules, profileId)
    .filter((origin) => !isOriginGranted(origin, grantedOrigins));
}

/**
 * Rules ReqKit can actually apply. Chrome already refuses to act on a host
 * without access, so filtering here keeps the badge and the rule set honest
 * rather than counting rules that silently do nothing.
 */
export function filterGrantedRules(rules, grantedOrigins) {
  if (grantedOrigins === undefined || grantedOrigins === null) {
    return Array.isArray(rules) ? rules : [];
  }

  return (Array.isArray(rules) ? rules : []).filter((rule) => isRuleGranted(rule, grantedOrigins));
}

function originPatternCovers(grantedPattern, requestedOrigin) {
  if (BROAD_ORIGIN_PATTERNS.includes(grantedPattern) || grantedPattern === requestedOrigin) {
    return true;
  }

  const wildcardMatch = /^https:\/\/\*\.([^/*]+)\/\*$/.exec(grantedPattern);
  const requestedMatch = /^https:\/\/([^/*]+)\/\*$/.exec(requestedOrigin);
  if (!wildcardMatch || !requestedMatch) {
    return false;
  }

  const wildcardDomain = wildcardMatch[1].toLowerCase();
  const requestedDomain = requestedMatch[1].toLowerCase();
  return requestedDomain === wildcardDomain || requestedDomain.endsWith(`.${wildcardDomain}`);
}
