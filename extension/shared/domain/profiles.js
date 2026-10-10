export const PROFILE_STORAGE_KEY = 'profiles';

export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_PROFILE_NAME = 'Default';

const MAX_PROFILE_NAME_LENGTH = 40;

export function createDefaultProfile() {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    createdAt: 0,
    defaultDurationMs: null
  };
}

export function createDefaultProfiles() {
  return [createDefaultProfile()];
}

export function createProfileId() {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `profile-${randomPart}`;
}

/**
 * Resolves any stored profile reference to a usable id. Rules written before
 * profiles existed carry no profile at all, so an empty reference always means
 * the default profile rather than an error.
 */
export function resolveProfileId(value) {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || DEFAULT_PROFILE_ID;
}

export function normalizeProfiles(rawProfiles) {
  const usedIds = new Set();
  const profiles = (Array.isArray(rawProfiles) ? rawProfiles : [])
    .map((profile) => normalizeProfile(profile, usedIds))
    .filter(Boolean);

  if (!profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID)) {
    profiles.unshift(createDefaultProfile());
  }

  return profiles;
}

function normalizeProfile(profile, usedIds) {
  const id = resolveProfileId(profile?.id);
  if (usedIds.has(id)) {
    return null;
  }

  const name = String(profile?.name || '').trim().slice(0, MAX_PROFILE_NAME_LENGTH)
    || (id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_NAME : id);
  const createdAt = Number.isFinite(Number(profile?.createdAt)) ? Number(profile.createdAt) : 0;
  const rawDuration = Number(profile?.defaultDurationMs);
  const defaultDurationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

  usedIds.add(id);
  return { id, name, createdAt, defaultDurationMs };
}

export function getProfileIds(profiles) {
  return new Set(normalizeProfiles(profiles).map((profile) => profile.id));
}

export function findProfile(profiles, id) {
  const resolvedId = resolveProfileId(id);
  return (Array.isArray(profiles) ? profiles : []).find((profile) => profile.id === resolvedId) || null;
}

export function hasProfile(profiles, id) {
  return Boolean(findProfile(profiles, id));
}

export function getProfileName(profiles, id) {
  return findProfile(profiles, id)?.name || DEFAULT_PROFILE_NAME;
}

export function createProfile(name, { now = Date.now() } = {}) {
  return {
    id: createProfileId(),
    name: String(name || '').trim().slice(0, MAX_PROFILE_NAME_LENGTH),
    createdAt: now,
    defaultDurationMs: null
  };
}

/**
 * Cloning a profile is the fastest route to a second environment: duplicate,
 * then change the two values that differ.
 */
export function cloneRulesIntoProfile(rules, sourceProfileId, targetProfileId, nextId) {
  const sourceId = resolveProfileId(sourceProfileId);
  let id = nextId;

  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => resolveProfileId(rule.profileId) === sourceId)
    .map((rule) => ({ ...rule, id: id++, profileId: resolveProfileId(targetProfileId) }));
}

export function removeRulesFromProfile(rules, profileId) {
  const sourceId = resolveProfileId(profileId);

  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => resolveProfileId(rule.profileId) !== sourceId);
}

export function countRulesInProfile(rules, profileId) {
  const resolvedId = resolveProfileId(profileId);
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => resolveProfileId(rule.profileId) === resolvedId).length;
}

export function validateProfileDraft(draft, existingProfiles, { excludeId = null } = {}) {
  const name = String(draft?.name || '').trim();

  if (!name) {
    return { ok: false, error: 'Enter a name for this profile.' };
  }

  if (name.length > MAX_PROFILE_NAME_LENGTH) {
    return { ok: false, error: `Profile names are limited to ${MAX_PROFILE_NAME_LENGTH} characters.` };
  }

  const duplicateProfile = (Array.isArray(existingProfiles) ? existingProfiles : []).some((profile) => (
    profile.id !== excludeId && profile.name.toLowerCase() === name.toLowerCase()
  ));

  if (duplicateProfile) {
    return { ok: false, error: `A profile named “${name}” already exists.` };
  }

  return { ok: true, profile: { name } };
}
