import { ACTIVATION_STORAGE_KEY, normalizeActivation } from '../shared/domain/activation.js';
import { PROFILE_STORAGE_KEY, getProfileIds, normalizeProfiles } from '../shared/domain/profiles.js';
import { RULE_STORAGE_KEY, normalizeRules } from '../shared/domain/rules.js';

export const SCHEMA_VERSION_KEY = 'schemaVersion';

export const MIGRATED_KEYS = [
  SCHEMA_VERSION_KEY,
  PROFILE_STORAGE_KEY,
  RULE_STORAGE_KEY,
  ACTIVATION_STORAGE_KEY
];

/**
 * Ordered, additive steps. Later work adds a step rather than editing an
 * existing one, so a profile written by an older build is upgraded exactly once.
 */
const MIGRATION_STEPS = [
  {
    version: 2,
    apply(state) {
      const profiles = normalizeProfiles(state[PROFILE_STORAGE_KEY]);
      const profileIds = getProfileIds(profiles);

      return {
        ...state,
        [PROFILE_STORAGE_KEY]: profiles,
        [RULE_STORAGE_KEY]: normalizeRules(state[RULE_STORAGE_KEY], { profileIds }),
        [ACTIVATION_STORAGE_KEY]: normalizeActivation(state[ACTIVATION_STORAGE_KEY], { profileIds })
      };
    }
  },
  {
    version: 3,
    apply: (state) => state
  },
  {
    version: 4,
    apply(state) {
      return {
        ...state,
        [RULE_STORAGE_KEY]: normalizeRules(state[RULE_STORAGE_KEY], {
          profileIds: getProfileIds(state[PROFILE_STORAGE_KEY])
        })
      };
    }
  }
];

export const CURRENT_SCHEMA_VERSION = MIGRATION_STEPS.at(-1).version;

/**
 * Pure migration. Every step is idempotent, so re-running over already-migrated
 * state produces the same result.
 */
export function migrateState(stored = {}) {
  const fromVersion = Number(stored?.[SCHEMA_VERSION_KEY]) || 0;
  let state = { ...stored };
  let changed = false;

  for (const step of MIGRATION_STEPS) {
    if (fromVersion >= step.version) {
      continue;
    }

    state = step.apply(state);
    changed = true;
  }

  if (changed) {
    state[SCHEMA_VERSION_KEY] = CURRENT_SCHEMA_VERSION;
  }

  return { state, changed, fromVersion, toVersion: CURRENT_SCHEMA_VERSION };
}

/**
 * Data keys are written before the version marker, so a failure part-way leaves
 * the old version in place and the migration simply re-runs next time.
 */
export async function ensureMigrated({ get, set }) {
  const stored = await get(MIGRATED_KEYS);
  const { state, changed } = migrateState(stored);

  if (changed) {
    await set({
      [PROFILE_STORAGE_KEY]: state[PROFILE_STORAGE_KEY],
      [RULE_STORAGE_KEY]: state[RULE_STORAGE_KEY],
      [ACTIVATION_STORAGE_KEY]: state[ACTIVATION_STORAGE_KEY]
    });
    await set({ [SCHEMA_VERSION_KEY]: state[SCHEMA_VERSION_KEY] });

    const removedCount = (Array.isArray(stored[RULE_STORAGE_KEY]) ? stored[RULE_STORAGE_KEY].length : 0)
      - state[RULE_STORAGE_KEY].length;
    if (removedCount > 0) {
      console.warn(`Removed ${removedCount} invalid saved header rule(s) during migration.`);
    }
  }

  return state;
}
