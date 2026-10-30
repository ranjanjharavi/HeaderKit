import { createDefaultActivation, isRuleLive } from './activation.js';
import { DEFAULT_PROFILE_ID, resolveProfileId } from './profiles.js';

export const RULE_STORAGE_KEY = 'headerRules';

const SUPPORTED_RESOURCE_TYPES = new Set(['all', 'xmlhttprequest']);
const MAX_PATH_PREFIX_LENGTH = 512;

export function normalizeRules(rules, { profileIds = null } = {}) {
  const normalizedRules = (Array.isArray(rules) ? rules : [])
    .map((rule) => normalizeRule(rule, profileIds))
    .filter(Boolean);
  const usedIds = new Set();
  let nextId = getNextRuleId(normalizedRules);

  return normalizedRules.map((rule) => {
    if (!Number.isInteger(rule.id) || rule.id < 1 || usedIds.has(rule.id)) {
      rule.id = nextId++;
    }
    usedIds.add(rule.id);
    return rule;
  });
}

function normalizeRule(rule, profileIds) {
  if (!rule) {
    return null;
  }

  const { host: domain } = parseHostInput(rule.domain);
  const headerName = String(rule.headerName || '').trim();
  const headerValue = String(rule.headerValue || '');
  const pathPrefix = normalizePathPrefix(rule.pathPrefix ?? '');
  const resourceType = normalizeResourceType(rule.resourceType ?? 'all');

  if (
    !domain ||
    pathPrefix === null ||
    resourceType === null ||
    !isValidHeaderName(headerName) ||
    !isValidHeaderValue(headerValue)
  ) {
    return null;
  }

  return {
    id: Number(rule.id),
    domain,
    headerName,
    headerValue: headerValue.trim(),
    pathPrefix,
    resourceType,
    enabled: rule.enabled !== false,
    profileId: normalizeRuleProfileId(rule.profileId, profileIds)
  };
}

/** Repair legacy stored references on load. Write intents reject unknown profiles. */
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
  if (
    path.includes('?') ||
    path.includes('#') ||
    path.includes('\\') ||
    [...path].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x20 || codePoint === 0x7f;
    })
  ) {
    return null;
  }

  const segments = path.split('/');
  if (segments.some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) {
    return null;
  }

  const canonicalPath = new URL(path, 'https://h.invalid').pathname;
  let end = canonicalPath.length;
  while (canonicalPath[end - 1] === '/') {
    end--;
  }
  const normalizedPath = canonicalPath.slice(0, end);
  return normalizedPath.length <= MAX_PATH_PREFIX_LENGTH ? normalizedPath : null;
}

export function getDisplayPathPrefix(value) {
  const path = String(value ?? '');
  try {
    const decoded = decodeURI(path);
    return normalizePathPrefix(decoded) === path ? decoded : path;
  } catch {
    return path;
  }
}

export function normalizeResourceType(value) {
  const resourceType = String(value || 'all')
    .trim()
    .toLowerCase();
  return SUPPORTED_RESOURCE_TYPES.has(resourceType) ? resourceType : null;
}

function hasExplicitPort(authority) {
  const hostEnd = authority.startsWith('[') ? authority.indexOf(']') + 1 : 0;
  return authority.slice(hostEnd).includes(':');
}

export function parseHostInput(value) {
  const input = String(value || '').trim();
  const invalidHost = { error: 'Enter a valid HTTPS host, such as api.example.com.' };
  if (!input) {
    return invalidHost;
  }
  if (input.includes('*')) {
    return { error: 'Wildcards are not supported. Enter one exact HTTPS host.' };
  }
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input) && !/^https:\/\//i.test(input)) {
    return { error: 'Only HTTPS hosts are supported.' };
  }

  const authority = input.replace(/^https:\/\//i, '').replace(/\/$/, '');
  if (authority.includes('@')) {
    return { error: 'Enter only the host, without credentials.' };
  }
  if (authority.includes('?')) {
    return { error: 'Enter only the host, without a query string.' };
  }
  if (authority.includes('#')) {
    return { error: 'Enter only the host, without a fragment.' };
  }
  if (authority.includes('/')) {
    return { error: 'Enter only the host. Put paths in Path prefix.' };
  }
  if (hasExplicitPort(authority)) {
    return { error: 'Enter only the host, without a port. Rules apply to all HTTPS ports.' };
  }
  if (
    authority.includes('\\') ||
    /\s/.test(authority) ||
    /[\u0000-\u001f\u007f]/.test(authority) ||
    !URL.canParse(`https://${authority}`)
  ) {
    return invalidHost;
  }

  const host = new URL(`https://${authority}`).hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    return { host };
  }
  if (host.length > 253 || !host.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) {
    return invalidHost;
  }
  if (/^\d+(?:\.\d+){3}$/.test(host) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(authority)) {
    return invalidHost;
  }
  return { host };
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

export function validateRuleDraft(
  draft,
  existingRules,
  { excludeId = null, enabled = true, activation = createDefaultActivation(), profileId = undefined } = {}
) {
  const parsedHost = parseHostInput(draft?.domain);
  const headerValue = String(draft?.headerValue || '');
  const rule = {
    domain: parsedHost.host,
    headerName: String(draft?.headerName || '').trim(),
    headerValue: headerValue.trim(),
    pathPrefix: normalizePathPrefix(draft?.pathPrefix ?? ''),
    resourceType: normalizeResourceType(draft?.resourceType ?? 'all')
  };
  const draftProfileId = resolveProfileId(profileId ?? draft?.profileId ?? activation?.profileId ?? DEFAULT_PROFILE_ID);

  if (!rule.domain) {
    return { ok: false, field: 'domain', error: parsedHost.error };
  }
  if (!rule.headerName) {
    return { ok: false, field: 'headerName', error: 'Enter a header name.' };
  }
  if (!rule.headerValue) {
    return { ok: false, field: 'headerValue', error: 'Enter a header value.' };
  }

  if (rule.pathPrefix === null) {
    return {
      ok: false,
      field: 'pathPrefix',
      error: 'Enter a valid path prefix up to 512 characters, without a query or fragment.'
    };
  }

  if (rule.resourceType === null) {
    return { ok: false, field: 'resourceType', error: 'Choose a supported request type.' };
  }

  if (!isValidHeaderName(rule.headerName)) {
    return { ok: false, field: 'headerName', error: 'Enter a valid HTTP header name.' };
  }

  if (!isValidHeaderValue(headerValue)) {
    return {
      ok: false,
      field: 'headerValue',
      error: 'Header values cannot contain control characters other than tabs.'
    };
  }

  // A profile can set a header once per request scope for a host. The value
  // and enabled state do not change that identity; edit the existing rule instead.
  const identity = getRuleIdentityKey({ ...rule, profileId: draftProfileId });
  const duplicateRule = (Array.isArray(existingRules) ? existingRules : []).some(
    (existingRule) => existingRule.id !== excludeId && getRuleIdentityKey(existingRule) === identity
  );

  if (duplicateRule) {
    return {
      ok: false,
      field: 'headerName',
      error: 'A rule for that header and request scope already exists for this host in this profile.'
    };
  }

  const conflictingRule = findActiveRuleConflict({ ...rule, enabled, profileId: draftProfileId }, existingRules, {
    excludeId,
    activation
  });
  if (conflictingRule) {
    return {
      ok: false,
      field: 'headerValue',
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
  return Boolean(normalizedValue.trim()) && !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(normalizedValue);
}

export function getNextRuleId(rules) {
  const ids = (Array.isArray(rules) ? rules : [])
    .map((rule) => Number(rule?.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function findActiveRuleConflict(
  candidate,
  rules,
  { excludeId = candidate?.id ?? null, activation = createDefaultActivation() } = {}
) {
  if (!isRuleLive(candidate, activation)) {
    return null;
  }

  return (
    (Array.isArray(rules) ? rules : []).find(
      (existingRule) => existingRule?.id !== excludeId && areRulesConflicting(candidate, existingRule, activation)
    ) || null
  );
}

export function getActiveRuleConflicts(rules, activation = createDefaultActivation()) {
  const liveRules = (Array.isArray(rules) ? rules : []).filter((rule) => isRuleLive(rule, activation));
  const conflicts = [];

  for (let leftIndex = 0; leftIndex < liveRules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < liveRules.length; rightIndex += 1) {
      const leftRule = liveRules[leftIndex];
      const rightRule = liveRules[rightIndex];
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

  const sameTarget =
    leftRule.domain === rightRule.domain &&
    String(leftRule.headerName).toLowerCase() === String(rightRule.headerName).toLowerCase();
  if (!sameTarget || !doScopesOverlap(leftRule, rightRule) || leftRule.headerValue === rightRule.headerValue) {
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
  return (Array.isArray(rules) ? rules : []).filter((rule) => resolveProfileId(rule?.profileId) === resolvedId);
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
  if (leftResourceType !== 'all' && rightResourceType !== 'all' && leftResourceType !== rightResourceType) {
    return false;
  }

  const leftPath = normalizePathPrefix(leftRule.pathPrefix ?? '') || '';
  const rightPath = normalizePathPrefix(rightRule.pathPrefix ?? '') || '';
  if (!leftPath || !rightPath) {
    return true;
  }

  return leftPath === rightPath || leftPath.startsWith(`${rightPath}/`) || rightPath.startsWith(`${leftPath}/`);
}

export function getRuleOriginPattern(rule) {
  return `https://${rule.domain}/*`;
}
