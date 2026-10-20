import { applyRuleIntent, commitRuleSet } from './background/rule-commit.js';
import { applyActivationIntent, applyProfileIntent, commitState } from './background/state-commit.js';
import {
  clearAlarm,
  createAlarm,
  getDynamicRules,
  getGrantedOrigins,
  getSessionRules,
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
  normalizeActivation,
  resolveActivation,
  setMasterEnabled,
  startBrowserSession
} from './shared/domain/activation.js';
import { PROFILE_STORAGE_KEY, getProfileIds, normalizeProfiles } from './shared/domain/profiles.js';
import { MIGRATED_KEYS, ensureMigrated } from './background/migrate.js';
import { resolveBadge } from './background/badge.js';
import { createSerialQueue } from './shared/runtime/serial-queue.js';

const EXPIRY_ALARM = 'reqkit:activation-expiry';
// Keep storage, DNR, alarm, and badge work ordered around the latest state.
const enqueueBackgroundTask = createSerialQueue();

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id || typeof sender?.url !== 'string'
    || !sender.url.startsWith(chrome.runtime.getURL(''))) {
    return false;
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
  enqueueBackgroundTask(() => refreshAfterPermissionChange()).catch((error) => {
    console.error('Could not apply rules after site access was granted.', error);
  });
});

chrome.permissions.onRemoved.addListener(() => {
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
  await refreshBadgesSafely(state);
  await scheduleExpiryAlarm(state.activation);
}

async function refreshAfterPermissionChange() {
  const state = await loadState();
  await applyDynamicRules(state.rules, state.activation, state.grantedOrigins);
  await refreshBadgesSafely(state);
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
  if (!changeInfo.url && changeInfo.status !== 'complete') {
    return;
  }

  enqueueBackgroundTask(() => refreshTabBadge(tabId, tab)).catch((error) => {
    console.error('Could not update the badge for that tab.', error);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  enqueueBackgroundTask(() => refreshTabBadge(tabId)).catch((error) => {
    console.error('Could not update the badge for the active tab.', error);
  });
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

  const state = await loadState({ newBrowserSession });
  await applyDynamicRules(state.rules, state.activation, state.grantedOrigins);
  await refreshBadgesSafely(state);
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
  await refreshBadgesSafely({ ...state, rules });
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
    storeState: (state) => storageAreaSet(chrome.storage.local, {
      [PROFILE_STORAGE_KEY]: state.profiles,
      [RULE_STORAGE_KEY]: state.rules,
      [ACTIVATION_STORAGE_KEY]: state.activation
    })
  });
  await refreshBadgesSafely(nextState);
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
  const stored = await storageAreaGet(chrome.storage.local, MIGRATED_KEYS);
  const profiles = normalizeProfiles(stored[PROFILE_STORAGE_KEY]);
  const profileIds = getProfileIds(profiles);
  const rules = normalizeRules(stored[RULE_STORAGE_KEY] || [], { profileIds });

  const storedActivation = normalizeActivation(stored[ACTIVATION_STORAGE_KEY], { profileIds });
  const sessionResult = newBrowserSession
    ? startBrowserSession(storedActivation)
    : { activation: storedActivation, changed: false };
  const expiryResult = resolveActivation(sessionResult.activation);

  if (sessionResult.changed || expiryResult.changed) {
    await storeActivation(expiryResult.activation);
  }

  const grantedOrigins = await getGrantedOriginsSafely();

  return {
    profiles,
    profileIds,
    rules,
    grantedOrigins,
    activation: expiryResult.activation
  };
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

async function refreshBadgesSafely(state) {
  try {
    await refreshBadges(state);
  } catch (error) {
    console.error('Could not update the extension badge.', error);
  }
}

/**
 * The default badge covers tabs whose address ReqKit cannot read; every tab it
 * can read gets an exact per-host count on top.
 */
async function refreshBadges({ rules, activation, grantedOrigins }) {
  const applicableRules = filterGrantedRules(rules, grantedOrigins);
  await paintBadge(resolveBadge(applicableRules, activation));

  const tabs = await queryTabs({});
  await Promise.all(tabs.map((tab) => (
    paintBadge(resolveBadge(applicableRules, activation, { url: tab.url }), tab.id)
  )));
}

async function refreshTabBadge(tabId, knownTab = null) {
  const { rules, activation, grantedOrigins } = await loadState();
  const tab = knownTab || await getTabSafely(tabId);
  const applicableRules = filterGrantedRules(rules, grantedOrigins);

  await paintBadge(resolveBadge(applicableRules, activation, { url: tab?.url }), tabId);
}

async function getTabSafely(tabId) {
  try {
    const tabs = await queryTabs({});
    return tabs.find((tab) => tab.id === tabId) || null;
  } catch (error) {
    console.error('Could not read that tab.', error);
    return null;
  }
}

async function paintBadge({ text, color }, tabId = null) {
  const target = tabId === null ? {} : { tabId };

  if (color) {
    await chrome.action.setBadgeBackgroundColor({ ...target, color });
  }
  await chrome.action.setBadgeText({ ...target, text });
}

function storeRules(rules) {
  return storageAreaSet(chrome.storage.local, { [RULE_STORAGE_KEY]: rules });
}

function storeActivation(activation) {
  return storageAreaSet(chrome.storage.local, { [ACTIVATION_STORAGE_KEY]: activation });
}
