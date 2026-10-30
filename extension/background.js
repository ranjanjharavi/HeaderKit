import { createBadgeController } from './background/badge.js';
import { createWorkerController, EXPIRY_ALARM } from './background/controller.js';
import { createMessageRouter } from './background/message-router.js';
import { createRuleApplication } from './background/rule-application.js';
import { createStateStore } from './background/state-store.js';
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
import { createSerialQueue } from './shared/runtime/serial-queue.js';

const chromeApi = globalThis.chrome;
const onError = (...args) => console.error(...args);
// Storage, DNR, timer work, and message reads all share this one queue.
const enqueueBackgroundTask = createSerialQueue();
const stateStore = createStateStore({
  get: (keys) => storageAreaGet(chromeApi.storage.local, keys, chromeApi),
  set: (values) => storageAreaSet(chromeApi.storage.local, values, chromeApi),
  getGrantedOrigins: () => getGrantedOrigins(chromeApi),
  onError
});
const applyRules = createRuleApplication({
  getDynamicRules: () => getDynamicRules(chromeApi),
  getSessionRules: () => getSessionRules(chromeApi),
  updateDynamicRules: (details) => updateDynamicRules(details, chromeApi),
  updateSessionRules: (details) => updateSessionRules(details, chromeApi),
  getRegexRuleLimit: () => chromeApi.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES,
  onError
});
let badgeStateRead = null;
const badges = createBadgeController({
  getState: getBadgeState,
  queryTabs: (query) => queryTabs(query, chromeApi),
  getTab: (tabId) => getTab(tabId, chromeApi),
  action: chromeApi.action,
  onError: (error) => onError('Could not update the extension badge.', error)
});
const controller = createWorkerController({
  stateStore,
  applyRules,
  badges,
  clearAlarm: (name) => clearAlarm(name, chromeApi),
  createAlarm: (name, details) => createAlarm(name, details, chromeApi),
  removeOriginPermission: (origin) => removeOriginPermission(origin, chromeApi),
  onError
});

// Register every listener synchronously at the entry point. Factory imports
// have no listener-registration side effects and no startup work is awaited.
chromeApi.storage.onChanged.addListener(stateStore.handleStorageChanges);
chromeApi.runtime.onMessage.addListener(
  createMessageRouter({
    extensionId: chromeApi.runtime.id,
    extensionRoot: chromeApi.runtime.getURL(''),
    enqueue: enqueueBackgroundTask,
    handlers: controller,
    onError
  })
);
chromeApi.runtime.onInstalled.addListener(() => {
  enqueueBackgroundTask(() => controller.initialize()).catch((error) => {
    onError('Could not restore saved header rules after install/update.', error);
  });
});
chromeApi.runtime.onStartup.addListener(() => {
  enqueueBackgroundTask(() => controller.initialize({ newBrowserSession: true })).catch((error) => {
    onError('Could not restore saved header rules on browser startup.', error);
  });
});
chromeApi.permissions.onAdded.addListener(() => {
  stateStore.invalidate();
  enqueueBackgroundTask(controller.refreshAfterPermissionChange).catch((error) => {
    onError('Could not apply rules after site access was granted.', error);
  });
});
chromeApi.permissions.onRemoved.addListener(() => {
  stateStore.invalidate();
  enqueueBackgroundTask(controller.refreshAfterPermissionChange).catch((error) => {
    onError('Could not update rules after site access was removed.', error);
  });
});
// A real alarm, rather than waiting for someone to reopen the popup.
chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== EXPIRY_ALARM) {
    return;
  }
  enqueueBackgroundTask(controller.applyExpiry).catch((error) => {
    onError('Could not apply the activation timer.', error);
  });
});
chromeApi.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-master') {
    return;
  }
  // Deliberately do not open the popup; the badge provides switch feedback.
  enqueueBackgroundTask(controller.toggleMasterSwitch).catch((error) => {
    onError('Could not toggle the HeaderKit master switch.', error);
  });
});
chromeApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    badges.refreshTab(tabId, { ...tab, url: changeInfo.url });
  }
});
chromeApi.tabs.onRemoved.addListener((tabId) => {
  badges.removeTab(tabId);
});

function getBadgeState() {
  const cached = stateStore.peek();
  if (cached) {
    return Promise.resolve(cached);
  }
  if (!badgeStateRead) {
    badgeStateRead = enqueueBackgroundTask(() => stateStore.load()).finally(() => {
      badgeStateRead = null;
    });
  }
  return badgeStateRead;
}
