import { filterRulesByProfile, getRuleOriginPattern } from './rules.js';

const BROAD_ORIGIN_PATTERNS = new Set(['https://*/*', '<all_urls>']);

/**
 * Every origin a profile needs in order to apply all of its rules.
 */
export function getProfileOrigins(rules, profileId) {
  return [...new Set(
    filterRulesByProfile(rules, profileId).map((rule) => getRuleOriginPattern(rule))
  )].sort((left, right) => left.localeCompare(right));
}

export function isOriginGranted(origin, grantedOrigins) {
  const granted = grantedOrigins instanceof Set ? grantedOrigins : new Set(grantedOrigins || []);
  if (granted.has(origin)) {
    return true;
  }
  for (const pattern of granted) {
    if (originPatternCovers(pattern, origin)) {
      return true;
    }
  }
  return false;
}

export function getRulesForOriginGrant(rules, origin) {
  const grant = new Set([origin]);
  return (Array.isArray(rules) ? rules : []).filter((rule) => isRuleGranted(rule, grant));
}

export function isBroadOrigin(origin) {
  return BROAD_ORIGIN_PATTERNS.has(origin) || /^https:\/\/\*\.[^/*]+\/\*$/.test(origin);
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
    let label = '';
    if (pattern === '<all_urls>') {
      label = 'all websites';
    } else if (pattern === 'https://*/*') {
      label = 'all https sites';
    }
    const searchableText = `${pattern} ${host} ${label}`.toLocaleLowerCase();
    return terms.every((term) => searchableText.includes(term))
      || (requestedOrigin && originPatternCovers(pattern, requestedOrigin));
  });
}

function getHostSearchOrigin(query) {
  let host = String(query || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/^https:\/\//, '');
  if (host.endsWith('/*')) {
    host = host.slice(0, -2);
  } else if (host.endsWith('/')) {
    host = host.slice(0, -1);
  }
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
 * Rules HeaderKit can actually apply. Chrome already refuses to act on a host
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
  if (BROAD_ORIGIN_PATTERNS.has(grantedPattern) || grantedPattern === requestedOrigin) {
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
