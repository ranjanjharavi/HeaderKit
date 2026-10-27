import { createProfileId, MAX_PROFILE_NAME_LENGTH, validateProfileDraft } from './profiles.js';
import { getNextRuleId, getRuleIdentityKey, validateRuleDraft } from './rules.js';

export const BACKUP_FORMAT = 'reqkit';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

const MAX_RULE_ID = 2147483647;

export function serializeBackup({ profiles, rules }, { now = new Date() } = {}) {
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    profiles: profiles.map(({ id, name, createdAt, defaultDurationMs }) => ({
      id, name, createdAt, defaultDurationMs
    })),
    rules: rules.map(({
      id, profileId, domain, headerName, headerValue, pathPrefix, resourceType, enabled
    }) => ({ id, profileId, domain, headerName, headerValue, pathPrefix, resourceType, enabled }))
  };
  const text = `${JSON.stringify(backup, null, 2)}\n`;
  // Export only backups that this version can read back without losing data.
  parseBackup(text);
  return text;
}

export function parseBackup(text) {
  if (typeof text !== 'string') {
    throw new Error('Choose a ReqKit JSON backup.');
  }
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('Backups must be 5 MiB or smaller.');
  }

  let backup;
  try {
    backup = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('This file is not valid JSON. Choose a ReqKit backup.');
  }
  if (!isRecord(backup) || backup.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a ReqKit backup.');
  }
  if (backup.version !== BACKUP_VERSION) {
    throw new Error('Unsupported backup version. Export a new backup with this version of ReqKit.');
  }
  if (!isValidExportDate(backup.exportedAt)) {
    throw new Error('The backup needs a valid ISO UTC export timestamp, such as 2026-01-01T00:00:00.000Z.');
  }
  if (!Array.isArray(backup.profiles) || !backup.profiles.length || !Array.isArray(backup.rules)) {
    throw new Error('The backup must contain profiles and a rules list.');
  }

  const profileIds = new Set();
  const profileNames = new Set();
  const profiles = backup.profiles.map((profile, index) => {
    const label = `Profile ${index + 1}`;
    if (!isRecord(profile) || typeof profile.id !== 'string' || !profile.id.trim()
      || profile.id !== profile.id.trim() || profile.id.length > 200
      || /[\u0000-\u001f\u007f]/.test(profile.id) || profileIds.has(profile.id)) {
      throw new Error(`${label} has an invalid or duplicate ID.`);
    }
    if (typeof profile.name !== 'string') {
      throw new Error(`${label} needs a valid name.`);
    }
    const validation = validateProfileDraft(profile, []);
    if (!validation.ok) {
      throw new Error(`${label}: ${validation.error}`);
    }
    const { name } = validation.profile;
    if (profileNames.has(name.toLowerCase())) {
      throw new Error(`${label} needs a unique name.`);
    }
    if (!Number.isFinite(profile.createdAt) || profile.createdAt < 0
      || (profile.defaultDurationMs !== null
        && (!Number.isFinite(profile.defaultDurationMs) || profile.defaultDurationMs <= 0))) {
      throw new Error(`${label} has invalid timing metadata.`);
    }
    profileIds.add(profile.id);
    profileNames.add(name.toLowerCase());
    return { id: profile.id, name, createdAt: profile.createdAt, defaultDurationMs: profile.defaultDurationMs };
  });

  const ruleIds = new Set();
  const identities = new Set();
  const rules = backup.rules.map((rule, index) => {
    const label = `Rule ${index + 1}`;
    if (!isRecord(rule) || !Number.isInteger(rule.id) || rule.id < 1 || rule.id > MAX_RULE_ID
      || ruleIds.has(rule.id)) {
      throw new Error(`${label} has an invalid or duplicate ID.`);
    }
    if (typeof rule.profileId !== 'string' || !profileIds.has(rule.profileId)) {
      throw new Error(`${label} refers to an unknown profile.`);
    }
    for (const field of ['domain', 'headerName', 'headerValue', 'pathPrefix']) {
      if (typeof rule[field] !== 'string') {
        throw new Error(`${label}: ${field} must be text.`);
      }
    }
    if (!['all', 'xmlhttprequest'].includes(rule.resourceType)) {
      throw new Error(`${label}: resourceType must be "all" or "xmlhttprequest".`);
    }
    if (typeof rule.enabled !== 'boolean') {
      throw new Error(`${label}: enabled must be true or false.`);
    }
    const validation = validateRuleDraft(rule, [], { enabled: false, profileId: rule.profileId });
    if (!validation.ok) {
      // With no existing rules, draft errors contain no imported or saved values.
      throw new Error(`${label}: ${validation.error}`);
    }
    const normalized = {
      ...validation.rule,
      id: rule.id,
      profileId: rule.profileId,
      enabled: rule.enabled
    };
    const identity = getRuleIdentityKey(normalized);
    if (identities.has(identity)) {
      throw new Error(`${label} duplicates a header and request scope in the same profile.`);
    }
    ruleIds.add(rule.id);
    identities.add(identity);
    return normalized;
  });

  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: backup.exportedAt, profiles, rules };
}

export function importBackup(text, state) {
  const backup = parseBackup(text);
  const usedIds = new Set(state.profiles.map((profile) => profile.id));
  const usedNames = new Set(state.profiles.map((profile) => profile.name.toLowerCase()));
  const profileMap = new Map();
  const profiles = backup.profiles.map((profile) => {
    const id = createProfileId();
    if (usedIds.has(id)) {
      throw new Error('Could not allocate an imported profile. Try again.');
    }
    const name = getImportedProfileName(profile.name, usedNames);
    usedIds.add(id);
    usedNames.add(name.toLowerCase());
    profileMap.set(profile.id, id);
    return { ...profile, id, name };
  });

  let nextId = getNextRuleId(state.rules);
  if (!Number.isSafeInteger(nextId) || nextId + backup.rules.length - 1 > MAX_RULE_ID) {
    throw new Error('Not enough rule IDs are available. Remove unused rules before importing.');
  }
  const rules = backup.rules.map((rule) => ({
    ...rule,
    id: nextId++,
    profileId: profileMap.get(rule.profileId),
    enabled: false
  }));

  return {
    ...state,
    profiles: [...state.profiles, ...profiles],
    rules: [...state.rules, ...rules]
  };
}

function getImportedProfileName(name, usedNames) {
  if (!usedNames.has(name.toLowerCase())) {
    return name;
  }
  let copy = 1;
  while (true) {
    const suffix = copy === 1 ? ' (imported)' : ` (imported ${copy})`;
    const candidate = `${name.slice(0, MAX_PROFILE_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!usedNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    copy++;
  }
}

function isValidExportDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const canonical = new Date(timestamp).toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
