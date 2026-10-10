import { DEFAULT_PROFILE_ID, resolveProfileId } from './profiles.js';

export const ACTIVATION_STORAGE_KEY = 'activation';

export function createDefaultActivation() {
  return {
    masterEnabled: true,
    profileId: DEFAULT_PROFILE_ID,
    lastProfileId: DEFAULT_PROFILE_ID,
    expiresAt: null,
    durationMs: null,
    untilBrowserClose: false
  };
}

export function normalizeActivation(rawActivation, { profileIds = null } = {}) {
  const fallback = createDefaultActivation();
  if (!rawActivation || typeof rawActivation !== 'object') {
    return fallback;
  }

  const profileId = normalizeProfileReference(rawActivation.profileId, profileIds, fallback.profileId);
  const lastProfileId = normalizeProfileReference(rawActivation.lastProfileId, profileIds, DEFAULT_PROFILE_ID)
    || DEFAULT_PROFILE_ID;
  const rawExpiresAt = Number(rawActivation.expiresAt);
  const rawDurationMs = Number(rawActivation.durationMs);
  const expiresAt = Number.isFinite(rawExpiresAt) && rawExpiresAt > 0 ? rawExpiresAt : null;

  return {
    masterEnabled: rawActivation.masterEnabled !== false,
    profileId,
    lastProfileId: profileId || lastProfileId,
    expiresAt,
    // Remembers which option armed the timer, so reopening a surface restores
    // the control to what the user picked rather than guessing from the clock.
    durationMs: expiresAt && Number.isFinite(rawDurationMs) && rawDurationMs > 0 ? rawDurationMs : null,
    untilBrowserClose: rawActivation.untilBrowserClose === true
  };
}

/**
 * `null` is a meaningful profile reference: it means nothing is live, which is
 * how an expired timer parks the extension without touching any rule.
 */
function normalizeProfileReference(value, profileIds, fallbackId) {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    return fallbackId;
  }

  const resolvedId = resolveProfileId(value);
  if (profileIds && !profileIds.has(resolvedId)) {
    return DEFAULT_PROFILE_ID;
  }

  return resolvedId;
}

/**
 * The single predicate that decides whether a rule reaches the network. Rules in
 * other profiles keep their own `enabled` flag untouched, which is what lets a
 * profile remember its internal state across switches.
 */
export function isRuleLive(rule, activation = createDefaultActivation()) {
  if (!rule || rule.enabled === false) {
    return false;
  }

  if (!activation?.masterEnabled || !activation.profileId) {
    return false;
  }

  return resolveProfileId(rule.profileId) === activation.profileId;
}

export function getLiveRules(rules, activation = createDefaultActivation()) {
  return (Array.isArray(rules) ? rules : []).filter((rule) => isRuleLive(rule, activation));
}

export function countLiveRules(rules, activation = createDefaultActivation()) {
  return getLiveRules(rules, activation).length;
}

/**
 * Which profile a newly created rule belongs to. Falls back to the last
 * selection so adding a rule while paused still lands somewhere sensible.
 */
export function getTargetProfileId(activation) {
  return activation?.profileId || activation?.lastProfileId || DEFAULT_PROFILE_ID;
}

/**
 * Why nothing is being applied, so each surface can say the accurate thing
 * rather than blaming the master switch for an elapsed timer.
 */
export function getActivationStatus(activation) {
  if (!activation?.masterEnabled) {
    return 'paused';
  }

  return activation.profileId ? 'live' : 'parked';
}

export function isActivationExpired(activation, now = Date.now()) {
  const expiresAt = Number(activation?.expiresAt);
  return Boolean(activation?.profileId) && Number.isFinite(expiresAt) && expiresAt > 0 && now >= expiresAt;
}

export function getRemainingMs(activation, now = Date.now()) {
  const expiresAt = Number(activation?.expiresAt);
  if (!activation?.profileId || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return null;
  }

  return Math.max(0, expiresAt - now);
}

/**
 * Arms or disarms the timer without touching which profile is selected.
 * A parked activation has nothing to time, so it is left alone.
 */
export function setActivationDuration(activation, {
  durationMs = null,
  untilBrowserClose = false,
  now = Date.now()
} = {}) {
  const normalizedActivation = normalizeActivation(activation);
  if (!normalizedActivation.profileId) {
    return normalizedActivation;
  }

  const duration = Number(durationMs);
  const hasDuration = Number.isFinite(duration) && duration > 0;

  return {
    ...normalizedActivation,
    expiresAt: hasDuration ? now + duration : null,
    durationMs: hasDuration ? duration : null,
    untilBrowserClose: Boolean(untilBrowserClose)
  };
}

/**
 * Deliberately coarse. A ticking countdown invites watching rather than working,
 * and the exact second never matters here.
 */
export function formatRemainingTime(remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 'less than a minute';
  }

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function deactivate(activation) {
  return {
    ...activation,
    profileId: null,
    lastProfileId: activation?.profileId || activation?.lastProfileId || DEFAULT_PROFILE_ID,
    expiresAt: null,
    durationMs: null,
    untilBrowserClose: false
  };
}

/**
 * Applies an elapsed timer. Returns `changed` so callers can persist and
 * re-apply only when the activation actually moved.
 */
export function resolveActivation(activation, now = Date.now()) {
  const normalizedActivation = normalizeActivation(activation);
  if (!isActivationExpired(normalizedActivation, now)) {
    return { activation: normalizedActivation, changed: false };
  }

  return { activation: deactivate(normalizedActivation), changed: true };
}

/**
 * "Until Chrome closes" needs no alarm — a new browser session is the signal.
 */
export function startBrowserSession(activation) {
  const normalizedActivation = normalizeActivation(activation);
  if (!normalizedActivation.untilBrowserClose) {
    return { activation: normalizedActivation, changed: false };
  }

  return { activation: deactivate(normalizedActivation), changed: true };
}

export function setMasterEnabled(activation, enabled) {
  const normalizedActivation = normalizeActivation(activation);
  if (enabled) {
    return {
      ...normalizedActivation,
      masterEnabled: true,
      profileId: normalizedActivation.profileId
        || normalizedActivation.lastProfileId
        || DEFAULT_PROFILE_ID
    };
  }

  return { ...normalizedActivation, masterEnabled: false };
}

/**
 * Selecting a profile always disarms any running timer and arms a fresh one, so
 * a duration belongs to the activation rather than to the profile.
 */
export function setActiveProfile(activation, profileId, {
  durationMs = null,
  untilBrowserClose = false,
  now = Date.now()
} = {}) {
  const normalizedActivation = normalizeActivation(activation);
  const nextProfileId = profileId === null ? null : resolveProfileId(profileId);
  const duration = Number(durationMs);
  const hasDuration = nextProfileId && Number.isFinite(duration) && duration > 0;

  return {
    ...normalizedActivation,
    profileId: nextProfileId,
    lastProfileId: nextProfileId || normalizedActivation.profileId || normalizedActivation.lastProfileId,
    expiresAt: hasDuration ? now + duration : null,
    durationMs: hasDuration ? duration : null,
    untilBrowserClose: Boolean(nextProfileId && untilBrowserClose)
  };
}
