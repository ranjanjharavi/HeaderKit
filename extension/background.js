import { applyRuleIntent, commitRuleSet } from './background/rule-commit.js';
import { importBackup, serializeBackup } from './shared/domain/backup.js';
import { applyActivationIntent, applyProfileIntent, commitState } from './background/state-commit.js';
import {
  clearAlarm,
  createAlarm,
  getDynamicRules,
  getGrantedOrigins,
  getSessionRules,
  getTab,
  queryTabs,
  removeOriginPermission,
  storageAreaGet,
  storageAreaSet,
  updateDynamicRules,
  updateSessionRules
} from './shared/runtime/chrome-api.js';
import { filterGrantedRules } from './shared/domain/site-access.js';
import {
  ACTIVATION_MESSAGE_SET_MASTER,
  ACTIVATION_MESSAGE_SET_PROFILE,
  ACTIVATION_MESSAGE_SET_DURATION,
  PROFILE_MESSAGE_CREATE,
  PROFILE_MESSAGE_RENAME,
  PROFILE_MESSAGE_DUPLICATE,
  PROFILE_MESSAGE_DELETE,
  STATE_MESSAGE_GET,
  BACKUP_MESSAGE_EXPORT,
  BACKUP_MESSAGE_IMPORT,
  RULE_MESSAGE_ADD,
  RULE_MESSAGE_UPDATE,
  RULE_MESSAGE_SET_ENABLED,
  RULE_MESSAGE_DELETE
} from './shared/runtime/messages.js';
import {
  RULE_STORAGE_KEY,
  buildDynamicRule,
  getRuleOriginPattern,
  normalizeRules
} from './shared/domain/rules.js';
import {
  ACTIVATION_STORAGE_KEY,
  getLiveRules,
  isActivationExpired,
  normalizeActivation,
  resolveActivation,
  setMasterEnabled,
  startBrowserSession
} from './shared/domain/activation.js';
import { PROFILE_STORAGE_KEY, getProfileIds, normalizeProfiles } from './shared/domain/profiles.js';
import { MIGRATED_KEYS, ensureMigrated } from './background/migrate.js';
import { createBadgeController } from './background/badge.js';
import { createSerialQueue } from './shared/runtime/serial-queue.js';

const EXPIRY_ALARM = 'reqkit:activation-expiry';
// Keep storage, DNR, and alarm work ordered around the latest state.
const enqueueBackgroundTask = createSerialQueue();
let cachedState = null;
let stateVersion = 0;
const pendingStorageWrites = new Set();
let badgeStateRead = null;
const badges = createBadgeController({
  getState: getBadgeState,
  queryTabs,
  getTab,
  action: chrome.action,
  onError: (error) => console.error('Could not update the extension badge.', error)
});

function getBadgeState() {
  if (cachedState && !isActivationExpired(cachedState.activation)) {
    return Promise.resolve(cachedState);
  }
  if (!badgeStateRead) {
    badgeStateRead = enqueueBackgroundTask(() => loadState()).finally(() => {
      badgeStateRead = null;
    });
  }
  return badgeStateRead;
}

const RULE_MESSAGES = new Set([
  RULE_MESSAGE_ADD, RULE_MESSAGE_UPDATE,
  RULE_MESSAGE_SET_ENABLED, RULE_MESSAGE_DELETE
]);
const ACTIVATION_MESSAGES = new Set([
  ACTIVATION_MESSAGE_SET_MASTER,
  ACTIVATION_MESSAGE_SET_PROFILE, ACTIVATION_MESSAGE_SET_DURATION
]);
const PROFILE_MESSAGES = new Set([
  PROFILE_MESSAGE_CREATE, PROFILE_MESSAGE_RENAME, PROFILE_MESSAGE_DUPLICATE, PROFILE_MESSAGE_DELETE
]);

function invalidateState() {
  cachedState = null;
  stateVersion++;
}

function getStoredValues(state) {
  return {
    [PROFILE_STORAGE_KEY]: state.profiles,
    [RULE_STORAGE_KEY]: state.rules,
    [ACTIVATION_STORAGE_KEY]: state.activation
  };
}

function areStoredValuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => (
    Object.hasOwn(right, key) && areStoredValuesEqual(left[key], right[key])
  ));
}

function matchesStoredChanges(changes, values) {
  return Object.entries(changes).every(([key, change]) => (
    Object.hasOwn(values, key) && areStoredValuesEqual(change.newValue, values[key])
  ));
}

chrome.storage.onChanged.addListener((changes, areaName) => {
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
  invalidateState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || typeof sender?.url !== 'string'
    || !sender.url.startsWith(chrome.runtime.getURL(''))) {
    return false;
  }

  if (message?.type === BACKUP_MESSAGE_EXPORT || message?.type === BACKUP_MESSAGE_IMPORT) {
    enqueueBackgroundTask(async () => {
      const state = await loadState();
      if (message.type === BACKUP_MESSAGE_EXPORT) {
        return { text: serializeBackup(state) };
      }
      const nextState = importBackup(message.text, state);
      await persistState(nextState, state);
      return {
        profileCount: nextState.profiles.length - state.profiles.length,
        ruleCount: nextState.rules.length - state.rules.length
      };
    }).then((result) => sendResponse({ ok: true, ...result })).catch((error) => {
      // Backup contents may contain credentials. Never log the payload.
      console.error('Could not process the backup request.');
      sendResponse({ ok: false, error: error.message || 'Could not process the backup.' });
    });
    return true;
  }

  if (RULE_MESSAGES.has(message?.type)) {
    enqueueBackgroundTask(() => handleRuleMessage(message))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error('Could not process the header rule request.', error);
        sendResponse({ ok: false, error: error.message || 'Could not update header rules.', field: error.field, conflictId: error.conflictId });
      });
    return true;
  }

  if (ACTIVATION_MESSAGES.has(message?.type)) {
    enqueueBackgroundTask(() => handleActivationMessage(message))
      .then((activation) => sendResponse({ ok: true, activation }))
      .catch((error) => {
        console.error('Could not process the activation request.', error);
        sendResponse({ ok: false, error: error.message || 'Could not update the ReqKit switch.' });
      });
    return true;
  }

  if (PROFILE_MESSAGES.has(message?.type) || message?.type === STATE_MESSAGE_GET) {
    enqueueBackgroundTask(async () => {
      const state = await loadState();
      if (message.type === STATE_MESSAGE_GET) {
        return state;
      }
      const nextState = applyProfileIntent(message, state);
      await persistState(nextState, state);
      await releaseUnusedPermissions(state.rules, nextState.rules);
      return nextState;
    }).then(({ rules, profiles, activation, profile }) => {
      sendResponse({ ok: true, rules, profiles, activation, profile });
    }).catch((error) => {
      console.error('Could not process the state request.', error);
      sendResponse({ ok: false, error: error.message || 'Could not update profiles.' });
    });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  enqueueBackgroundTask(() => initialize()).catch((error) => {
    console.error('Could not restore saved header rules after install/update.', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueueBackgroundTask(() => initialize({ newBrowserSession: true })).catch((error) => {
    console.error('Could not restore saved header rules on browser startup.', error);
  });
});

chrome.permissions.onAdded.addListener(() => {
  invalidateState();
  enqueueBackgroundTask(() => refreshAfterPermissionChange()).catch((error) => {
    console.error('Could not apply rules after site access was granted.', error);
  });
});

chrome.permissions.onRemoved.addListener(() => {
  invalidateState();
  enqueueBackgroundTask(() => refreshAfterPermissionChange()).catch((error) => {
    console.error('Could not update rules after site access was removed.', error);
  });
});

/**
 * An alarm rather than a lazy timestamp check: a safety feature that only
 * expires the next time you happen to open the popup is not one.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== EXPIRY_ALARM) {
    return;
  }

  enqueueBackgroundTask(() => applyExpiry()).catch((error) => {
    console.error('Could not apply the activation timer.', error);
  });
});

/**
 * loadState resolves and persists the elapsed timer, so this only has to push
 * the result out to the rule set and the badges.
 */
async function applyExpiry() {
  const state = await loadState();
  await applyDynamicRules(state.rules, state.activation, state.grantedOrigins);
  badges.refresh();
  await scheduleExpiryAlarm(state.activation);
}

async function refreshAfterPermissionChange() {
  const state = await loadState();
  await applyDynamicRules(state.rules, state.activation, state.grantedOrigins);
  badges.refresh();
}

async function scheduleExpiryAlarm(activation) {
  try {
    await clearAlarm(EXPIRY_ALARM);
    if (activation?.expiresAt) {
      await createAlarm(EXPIRY_ALARM, { when: activation.expiresAt });
    }
  } catch (error) {
    console.error('Could not schedule the activation timer.', error);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-master') {
    return;
  }

  enqueueBackgroundTask(() => toggleMasterSwitch()).catch((error) => {
    console.error('Could not toggle the ReqKit master switch.', error);
  });
});

// A navigation changes which rules apply to the tab, so its badge is recomputed.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) {
    return;
  }

  badges.refreshTab(tabId, { ...tab, url: changeInfo.url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  badges.removeTab(tabId);
});

/**
 * Deliberately does not open the popup: flip off, reload the page, confirm the
 * bug is real, flip back. The badge is the only feedback needed.
 */
async function toggleMasterSwitch() {
  const state = await loadState();
  await commitActivation(setMasterEnabled(state.activation, !state.activation.masterEnabled), state);
}

async function initialize({ newBrowserSession = false } = {}) {
  await ensureMigrated({
    get: (keys) => storageAreaGet(chrome.storage.local, keys),
    set: (value) => storageAreaSet(chrome.storage.local, value)
  });

  invalidateState();
  const state = await loadState({ newBrowserSession });
  await applyDynamicRules(state.rules, state.activation, state.grantedOrigins);
  badges.refresh();
  await scheduleExpiryAlarm(state.activation);
}

async function handleRuleMessage(message) {
  const state = await loadState();

  const result = applyRuleIntent(message, state);
  const rules = await commitRuleSet(result.rules, {
    activation: state.activation,
    profileIds: state.profileIds,
    getCurrentRules: async () => state.rules,
    applyRules: (nextRules) => applyDynamicRules(nextRules, state.activation, state.grantedOrigins),
    storeRules
  });

  await releaseUnusedPermissions(state.rules, rules);
  badges.refresh();
  return { rules, rule: result.rule };
}

async function handleActivationMessage(message) {
  const state = await loadState();

  const nextActivation = applyActivationIntent(message, state);
  return commitActivation(nextActivation, state);
}

/**
 * The worker owns the applied rule sets and the badges, so every activation
 * change lands here rather than being written to storage by a page.
 */
async function commitActivation(activation, state) {
  await persistState({ ...state, activation }, state);
  return activation;
}

async function persistState(nextState, previousState) {
  await commitState(nextState, previousState, {
    applyState: (state) => applyDynamicRules(state.rules, state.activation, state.grantedOrigins),
    storeState: (state) => storeStateValues(getStoredValues(state), state)
  });
  badges.refresh();
  await scheduleExpiryAlarm(nextState.activation);
}

async function releaseUnusedPermissions(previousRules, rules) {
  const remainingDomains = new Set(rules.map((rule) => rule.domain));
  const origins = new Set(previousRules.filter((rule) => !remainingDomains.has(rule.domain)).map(getRuleOriginPattern));
  await Promise.all([...origins].map(async (origin) => {
    try {
      await removeOriginPermission(origin);
    } catch (error) {
      console.error(`Could not release site access for ${origin}.`, error);
    }
  }));
}

/**
 * Single read path for everything the worker needs. Expiry is resolved here so
 * a timer that elapsed while the worker was asleep takes effect on the next
 * wake, and the resolved activation is written back before it is used.
 */
async function loadState({ newBrowserSession = false } = {}) {
  const version = stateVersion;
  let state = cachedState;
  if (!state || newBrowserSession) {
    const stored = await storageAreaGet(chrome.storage.local, MIGRATED_KEYS);
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
    return loadState({ newBrowserSession });
  }
  const resolvedState = { ...state, activation: expiryResult.activation };
  cachedState = state.grantedOrigins === null ? null : resolvedState;
  return resolvedState;
}

async function getGrantedOriginsSafely() {
  try {
    return await getGrantedOrigins();
  } catch (error) {
    console.error('Could not read granted site access.', error);
    return null;
  }
}

async function applyDynamicRules(rules, activation, grantedOrigins) {
  const [dynamicRules, sessionRules] = await Promise.all([getDynamicRules(), getSessionRules()]);
  const applicableRules = filterGrantedRules(rules, grantedOrigins);
  const addRules = getLiveRules(applicableRules, activation).map(buildDynamicRule);
  const regexLimit = chrome.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES;
  if (addRules.length > regexLimit) {
    throw new Error(`Chrome supports at most ${regexLimit} active header rules. Pause or remove some rules first.`);
  }

  let activeRules = dynamicRules;
  let inactiveRules = sessionRules;
  let updateActive = updateDynamicRules;
  let updateInactive = updateSessionRules;
  if (activation.untilBrowserClose) {
    activeRules = sessionRules;
    inactiveRules = dynamicRules;
    updateActive = updateSessionRules;
    updateInactive = updateDynamicRules;
  }
  if (inactiveRules.length) {
    await updateInactive({ removeRuleIds: inactiveRules.map((rule) => rule.id), addRules: [] });
  }
  try {
    await updateActive({ removeRuleIds: activeRules.map((rule) => rule.id), addRules });
  } catch (error) {
    if (inactiveRules.length) {
      try {
        await updateInactive({ removeRuleIds: [], addRules: inactiveRules });
      } catch (rollbackError) {
        console.error('Could not restore the previous applied rules.', rollbackError);
      }
    }
    throw error;
  }
}

function storeRules(rules) {
  const nextState = cachedState ? { ...cachedState, rules } : null;
  return storeStateValues({ [RULE_STORAGE_KEY]: rules }, nextState);
}

function storeActivation(activation) {
  const nextState = cachedState ? { ...cachedState, activation } : null;
  return storeStateValues({ [ACTIVATION_STORAGE_KEY]: activation }, nextState);
}

async function storeStateValues(values, nextState) {
  const version = stateVersion;
  pendingStorageWrites.add(values);
  try {
    await storageAreaSet(chrome.storage.local, values);
    if (version === stateVersion && nextState && nextState.grantedOrigins !== null) {
      cachedState = { ...nextState, profileIds: getProfileIds(nextState.profiles) };
    }
  } finally {
    pendingStorageWrites.delete(values);
  }
}
