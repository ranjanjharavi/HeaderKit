import {
  ACTIVATION_STORAGE_KEY,
  isActivationExpired,
  normalizeActivation,
  resolveActivation,
  startBrowserSession
} from '../shared/domain/activation.js';
import {
  PROFILE_STORAGE_KEY,
  createDefaultProfiles,
  getProfileIds,
  normalizeProfiles
} from '../shared/domain/profiles.js';
import { RULE_STORAGE_KEY, normalizeRules } from '../shared/domain/rules.js';
import { MIGRATED_KEYS, ensureMigrated } from './migrate.js';

/** Owns storage normalization and cache validity, but never registers listeners or queues work. */
export function createStateStore({ get, set, getGrantedOrigins, onError }) {
  let cachedState = null;
  let stateVersion = 0;
  const pendingStorageWrites = new Set();

  function invalidate() {
    cachedState = null;
    stateVersion++;
  }

  function peek() {
    return cachedState && !isActivationExpired(cachedState.activation) ? cachedState : null;
  }

  function handleStorageChanges(changes, areaName) {
    if (areaName !== 'local') {
      return;
    }
    if (cachedState && matchesStoredChanges(changes, getStoredValues(cachedState))) {
      return;
    }
    for (const values of pendingStorageWrites) {
      if (matchesStoredChanges(changes, values)) {
        return;
      }
    }
    invalidate();
  }

  // Resolve and persist expiry before publishing a snapshot, including on a
  // worker wake after a timer elapsed. Storage events may invalidate an await.
  async function load({ newBrowserSession = false } = {}) {
    const version = stateVersion;
    let state = cachedState;
    if (!state || newBrowserSession) {
      const stored = await get(MIGRATED_KEYS);
      const profiles = normalizeProfiles(stored[PROFILE_STORAGE_KEY]);
      const profileIds = getProfileIds(profiles);
      state = {
        profiles,
        profileIds,
        rules: normalizeRules(stored[RULE_STORAGE_KEY] || [], { profileIds }),
        activation: normalizeActivation(stored[ACTIVATION_STORAGE_KEY], { profileIds }),
        grantedOrigins: await getGrantedOriginsSafely()
      };
    }

    const sessionResult = newBrowserSession
      ? startBrowserSession(state.activation)
      : { activation: state.activation, changed: false };
    const expiryResult = resolveActivation(sessionResult.activation);
    if (sessionResult.changed || expiryResult.changed) {
      await storeActivation(expiryResult.activation);
    }
    if (version !== stateVersion) {
      return load({ newBrowserSession });
    }
    const resolvedState = { ...state, activation: expiryResult.activation };
    cachedState = state.grantedOrigins === null ? null : resolvedState;
    return resolvedState;
  }

  async function getGrantedOriginsSafely() {
    try {
      return await getGrantedOrigins();
    } catch (error) {
      onError('Could not read granted site access.', error);
      return null;
    }
  }

  // Backups read saved data only: do not resolve timers, normalize away invalid
  // data, or depend on current grants. Serialization validates the raw result.
  async function readBackupData() {
    const stored = await get([PROFILE_STORAGE_KEY, RULE_STORAGE_KEY]);
    return {
      profiles: stored[PROFILE_STORAGE_KEY] ?? createDefaultProfiles(),
      rules: stored[RULE_STORAGE_KEY] ?? []
    };
  }

  function storeRules(rules) {
    const nextState = cachedState ? { ...cachedState, rules } : null;
    return storeValues({ [RULE_STORAGE_KEY]: rules }, nextState);
  }

  function storeActivation(activation) {
    const nextState = cachedState ? { ...cachedState, activation } : null;
    return storeValues({ [ACTIVATION_STORAGE_KEY]: activation }, nextState);
  }

  function storeState(state) {
    return storeValues(getStoredValues(state), state);
  }

  async function storeValues(values, nextState) {
    const version = stateVersion;
    pendingStorageWrites.add(values);
    try {
      await set(values);
      if (version === stateVersion && nextState && nextState.grantedOrigins !== null) {
        cachedState = { ...nextState, profileIds: getProfileIds(nextState.profiles) };
      }
    } finally {
      pendingStorageWrites.delete(values);
    }
  }

  return {
    load,
    peek,
    invalidate,
    handleStorageChanges,
    readBackupData,
    storeRules,
    storeState,
    migrate: () => ensureMigrated({ get, set })
  };
}

function getStoredValues(state) {
  return {
    [PROFILE_STORAGE_KEY]: state.profiles,
    [RULE_STORAGE_KEY]: state.rules,
    [ACTIVATION_STORAGE_KEY]: state.activation
  };
}

function matchesStoredChanges(changes, values) {
  return Object.entries(changes).every(
    ([key, change]) => Object.hasOwn(values, key) && areStoredValuesEqual(change.newValue, values[key])
  );
}

function areStoredValuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && areStoredValuesEqual(left[key], right[key]))
  );
}
