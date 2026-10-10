import { createDefaultActivation, isRuleLive } from './activation.js';
import { DEFAULT_PROFILE_ID, resolveProfileId } from './profiles.js';

export const RULE_STORAGE_KEY = 'headerRules';

const REQUEST_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'other'
];
const SUPPORTED_RESOURCE_TYPES = new Set(['all', 'xmlhttprequest']);
const MAX_PATH_PREFIX_LENGTH = 512;

export function normalizeRules(rules, { profileIds = null } = {}) {
  const usedIds = new Set();
  let nextId = 1;

  return (Array.isArray(rules) ? rules : [])
    .map((rule) => normalizeRule(rule, usedIds, () => nextId++, profileIds))
    .filter(Boolean);
}

function normalizeRule(
  rule,
  usedIds = new Set(),
  getNextId = createSequentialIdFactory(),
  profileIds = null
) {
  if (!rule) {
    return null;
  }

  const domain = normalizeDomain(rule.domain || '');
  const headerName = String(rule.headerName || '').trim();
  const headerValue = String(rule.headerValue || '').trim();
  const pathPrefix = normalizePathPrefix(rule.pathPrefix ?? '');
  const resourceType = normalizeResourceType(rule.resourceType ?? 'all');

  if (!domain || pathPrefix === null || resourceType === null
    || !isValidHeaderName(headerName) || !isValidHeaderValue(headerValue)) {
    return null;
  }

  let id = Number(rule.id);
  if (!Number.isInteger(id) || id < 1 || usedIds.has(id)) {
    id = getNextId();
  }

  while (usedIds.has(id)) {
    id = getNextId();
  }
  usedIds.add(id);

  return {
    id,
    domain,
    headerName,
    headerValue,
    pathPrefix,
    resourceType,
    enabled: rule.enabled !== false,
    profileId: normalizeRuleProfileId(rule.profileId, profileIds)
  };
}

/**
 * An unrecognized profile is repaired rather than dropped. `commitRuleSet`
 * rejects a set whose normalized length shrank, so dropping here would turn one
 * stale reference into a permanent commit failure.
 */
function normalizeRuleProfileId(value, profileIds) {
  const resolvedId = resolveProfileId(value);
  return !profileIds || profileIds.has(resolvedId) ? resolvedId : DEFAULT_PROFILE_ID;
}

export function normalizePathPrefix(value) {
  const cleanedValue = String(value ?? '').trim();
  if (!cleanedValue) {
    return '';
  }
  if (cleanedValue.length > MAX_PATH_PREFIX_LENGTH) {
    return null;
  }

  const path = `/${cleanedValue.replace(/^\/+/, '')}`;
  if (path.includes('?') || path.includes('#') || path.includes('\\')
    || [...path].some((character) => {
      const codePoint = character.charCodeAt(0);
      return codePoint <= 0x20 || codePoint === 0x7f;
    })) {
    return null;
  }

  const segments = path.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }

  return path.replace(/\/+$/, '') || '';
}

function normalizeResourceType(value) {
  const resourceType = String(value || 'all').trim().toLowerCase();
  return SUPPORTED_RESOURCE_TYPES.has(resourceType) ? resourceType : null;
}

export function normalizeDomain(value) {
  const cleanedValue = String(value || '').trim();
  if (!cleanedValue) {
    return '';
  }

  const hadHttpsProtocol = /^https:\/\//i.test(cleanedValue);
  const hadOtherProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(cleanedValue) && !hadHttpsProtocol;
  if (hadOtherProtocol) {
    return '';
  }

  const candidate = hadHttpsProtocol ? cleanedValue : `https://${cleanedValue.replace(/^\/+/, '')}`;
  if (!URL.canParse(candidate)) {
    return '';
  }

  const parsed = new URL(candidate);
  return parsed.hostname && parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : '';
}

export function validateRuleDraft(draft, existingRules, {
  excludeId = null,
  enabled = true,
  activation = createDefaultActivation(),
  profileId = undefined
} = {}) {
  const rule = {
    domain: normalizeDomain(draft?.domain),
    headerName: String(draft?.headerName || '').trim(),
    headerValue: String(draft?.headerValue || '').trim(),
    pathPrefix: normalizePathPrefix(draft?.pathPrefix ?? ''),
    resourceType: normalizeResourceType(draft?.resourceType ?? 'all')
  };
  const draftProfileId = resolveProfileId(
    profileId ?? draft?.profileId ?? activation?.profileId ?? DEFAULT_PROFILE_ID
  );

  if (!rule.domain || !rule.headerName || !rule.headerValue) {
    return { ok: false, error: 'A valid HTTPS host, header name, and header value are required.' };
  }

  if (rule.pathPrefix === null) {
    return { ok: false, error: 'Enter a valid path prefix up to 512 characters, without a query or fragment.' };
  }

  if (rule.resourceType === null) {
    return { ok: false, error: 'Choose a supported request type.' };
  }

  if (!isValidHeaderName(rule.headerName)) {
    return { ok: false, error: 'Enter a valid HTTP header name.' };
  }

  if (!isValidHeaderValue(rule.headerValue)) {
    return { ok: false, error: 'Header values cannot contain line breaks.' };
  }

  // A profile can set a header once per request scope for a host. The value
  // and enabled state do not change that identity; edit the existing rule instead.
  const identity = getRuleIdentityKey({ ...rule, profileId: draftProfileId });
  const duplicateRule = (Array.isArray(existingRules) ? existingRules : []).some((existingRule) => (
    existingRule.id !== excludeId && getRuleIdentityKey(existingRule) === identity
  ));

  if (duplicateRule) {
    return { ok: false, error: 'A rule for that header and request scope already exists for this host in this profile.' };
  }

  const conflictingRule = findActiveRuleConflict(
    { ...rule, enabled, profileId: draftProfileId },
    existingRules,
    { excludeId, activation }
  );
  if (conflictingRule) {
    return {
      ok: false,
      error: getRuleConflictMessage(conflictingRule),
      conflictId: conflictingRule.id
    };
  }

  return { ok: true, rule };
}

export function getRuleIdentityKey(rule) {
  return [
    resolveProfileId(rule?.profileId),
    String(rule?.domain || '').toLowerCase(),
    String(rule?.headerName || '').toLowerCase(),
    normalizePathPrefix(rule?.pathPrefix ?? '') ?? '',
    normalizeResourceType(rule?.resourceType ?? 'all') ?? 'all'
  ].join('\n');
}

function isValidHeaderName(value) {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(String(value || ''));
}

function isValidHeaderValue(value) {
  const normalizedValue = String(value || '');
  return Boolean(normalizedValue) && !/[\r\n]/.test(normalizedValue);
}

export function getNextRuleId(rules) {
  const ids = (Array.isArray(rules) ? rules : [])
    .map((rule) => Number(rule?.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function findActiveRuleConflict(candidate, rules, {
  excludeId = candidate?.id ?? null,
  activation = createDefaultActivation()
} = {}) {
  if (!isRuleLive(candidate, activation)) {
    return null;
  }

  return (Array.isArray(rules) ? rules : []).find((existingRule) => (
    existingRule?.id !== excludeId && areRulesConflicting(candidate, existingRule, activation)
  )) || null;
}

export function getActiveRuleConflicts(rules, activation = createDefaultActivation()) {
  const normalizedRules = Array.isArray(rules) ? rules : [];
  const conflicts = [];

  for (let leftIndex = 0; leftIndex < normalizedRules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalizedRules.length; rightIndex += 1) {
      const leftRule = normalizedRules[leftIndex];
      const rightRule = normalizedRules[rightIndex];
      if (areRulesConflicting(leftRule, rightRule, activation)) {
        conflicts.push({ leftRule, rightRule });
      }
    }
  }

  return conflicts;
}

/**
 * Rules conflict only when they are live together, target the same header, and
 * their path/resource scopes overlap.
 */
export function areRulesConflicting(leftRule, rightRule, activation = createDefaultActivation()) {
  if (!isRuleLive(leftRule, activation) || !isRuleLive(rightRule, activation)) {
    return false;
  }

  const sameTarget = leftRule.domain === rightRule.domain
    && String(leftRule.headerName).toLowerCase() === String(rightRule.headerName).toLowerCase();
  if (!sameTarget || !doScopesOverlap(leftRule, rightRule)
    || leftRule.headerValue === rightRule.headerValue) {
    return false;
  }

  return true;
}

export function getRuleConflictMessage(conflictingRule) {
  return `Conflicts with the active ${conflictingRule.headerName} rule for ${conflictingRule.domain} because their request scopes overlap and they use different values.`;
}

export function filterRulesByHost(rules, hostname) {
  const normalizedHostname = normalizeDomain(hostname);
  if (!normalizedHostname) {
    return Array.isArray(rules) ? rules : [];
  }

  return (Array.isArray(rules) ? rules : []).filter((rule) => rule.domain === normalizedHostname);
}

export function filterRulesByProfile(rules, profileId) {
  const resolvedId = resolveProfileId(profileId);
  return (Array.isArray(rules) ? rules : []).filter((rule) => (
    resolveProfileId(rule?.profileId) === resolvedId
  ));
}

export function groupRulesByDomain(rules) {
  const grouped = new Map();

  (Array.isArray(rules) ? rules : []).forEach((rule) => {
    const domainRules = grouped.get(rule.domain) || [];
    domainRules.push(rule);
    grouped.set(rule.domain, domainRules);
  });

  return Array.from(grouped, ([domain, groupedDomainRules]) => ({
    domain,
    rules: groupedDomainRules
  }));
}

function doScopesOverlap(leftRule, rightRule) {
  const leftResourceType = normalizeResourceType(leftRule.resourceType ?? 'all') || 'all';
  const rightResourceType = normalizeResourceType(rightRule.resourceType ?? 'all') || 'all';
  if (leftResourceType !== 'all' && rightResourceType !== 'all'
    && leftResourceType !== rightResourceType) {
    return false;
  }

  const leftPath = normalizePathPrefix(leftRule.pathPrefix ?? '') || '';
  const rightPath = normalizePathPrefix(rightRule.pathPrefix ?? '') || '';
  if (!leftPath || !rightPath) {
    return true;
  }

  return leftPath === rightPath
    || leftPath.startsWith(`${rightPath}/`)
    || rightPath.startsWith(`${leftPath}/`);
}

export function buildDynamicRule(rule) {
  const pathCondition = normalizePathPrefix(rule.pathPrefix ?? '');
  const pathRegex = pathCondition
    ? `${escapeRegex(pathCondition)}(?:/|[?#]|$)`
    : '(?:[/?#]|$)';
  const resourceType = normalizeResourceType(rule.resourceType ?? 'all') || 'all';

  return {
    id: rule.id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: rule.headerName,
          operation: 'set',
          value: rule.headerValue
        }
      ]
    },
    condition: {
      resourceTypes: resourceType === 'all' ? REQUEST_RESOURCE_TYPES : [resourceType],
      regexFilter: String.raw`^https:\/\/${escapeRegex(rule.domain)}(?::\d+)?${pathRegex}`
    }
  };
}

export function getRuleOriginPattern(rule) {
  return `https://${rule.domain}/*`;
}

function escapeRegex(value) {
  return String(value).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createSequentialIdFactory() {
  let nextId = 1;
  return () => nextId++;
}
