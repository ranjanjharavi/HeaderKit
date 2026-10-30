let nextWorkerId = 0;

function createEvent() {
  const listeners = [];
  return {
    addListener: (listener) => listeners.push(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args)),
    get listenerCount() {
      return listeners.length;
    }
  };
}

export async function installBackgroundHarness(chromeApi) {
  const messages = [];
  const writes = [];
  let dynamicRules = [];
  let sessionRules = [];
  let failedRuleUpdate = null;
  const storageChanges = createEvent();
  const set = chromeApi.storage.local.set.bind(chromeApi.storage.local);
  chromeApi.storage.local.set = (value, callback) => {
    set(value, () => {
      if (chromeApi.runtime.lastError) {
        callback();
        return;
      }
      writes.push(structuredClone(value));
      callback();
      const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }]));
      storageChanges.emit(changes, 'local');
    });
  };
  chromeApi.storage.onChanged = storageChanges;
  chromeApi.runtime.id ??= 'headerkit-test';
  chromeApi.runtime.getURL ??= (path) => `chrome-extension://${chromeApi.runtime.id}/${path}`;
  chromeApi.runtime.onMessage = {
    addListener: (listener) => messages.push(listener),
    get listenerCount() {
      return messages.length;
    }
  };
  chromeApi.runtime.onInstalled = createEvent();
  chromeApi.runtime.onStartup = createEvent();
  chromeApi.runtime.sendMessage = (message, callback) => {
    sendMessageFrom(
      message,
      {
        id: chromeApi.runtime.id,
        url: chromeApi.runtime.getURL('popup/index.html')
      },
      callback
    );
  };
  function sendMessageFrom(message, sender, callback) {
    const handled = messages.some((listener) => listener(message, sender, callback));
    if (!handled) {
      callback(undefined);
    }
  }
  chromeApi.permissions.onAdded = createEvent();
  chromeApi.permissions.onRemoved = createEvent();
  for (const [method, event] of [
    ['request', 'onAdded'],
    ['remove', 'onRemoved']
  ]) {
    const original = chromeApi.permissions[method]?.bind(chromeApi.permissions);
    if (original) {
      chromeApi.permissions[method] = (details, callback) =>
        original(details, (changed) => {
          callback(changed);
          if (changed) {
            chromeApi.permissions[event].emit(details);
          }
        });
    }
  }
  chromeApi.action = {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {}
  };
  chromeApi.alarms = {
    onAlarm: createEvent(),
    clear: (_name, callback) => callback(true),
    create: (_name, _options, callback) => callback()
  };
  chromeApi.commands = { onCommand: createEvent() };
  chromeApi.tabs ??= { query: (_query, callback) => callback([]) };
  chromeApi.tabs.get ??= (tabId, callback) => callback({ id: tabId });
  chromeApi.tabs.onUpdated = createEvent();
  chromeApi.tabs.onActivated = createEvent();
  chromeApi.tabs.onRemoved = createEvent();
  chromeApi.declarativeNetRequest = {
    MAX_NUMBER_OF_REGEX_RULES: 1000,
    getDynamicRules: (callback) => callback(structuredClone(dynamicRules)),
    getSessionRules: (callback) => callback(structuredClone(sessionRules)),
    updateDynamicRules: ({ removeRuleIds, addRules }, callback) => {
      if (rejectRuleUpdate('dynamic', callback)) {
        return;
      }
      dynamicRules = [...dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)), ...structuredClone(addRules)];
      callback();
    },
    updateSessionRules: ({ removeRuleIds, addRules }, callback) => {
      if (rejectRuleUpdate('session', callback)) {
        return;
      }
      sessionRules = [...sessionRules.filter((rule) => !removeRuleIds.includes(rule.id)), ...structuredClone(addRules)];
      callback();
    }
  };
  function rejectRuleUpdate(kind, callback) {
    if (failedRuleUpdate !== kind) {
      return false;
    }
    failedRuleUpdate = null;
    chromeApi.runtime.lastError = { message: 'Rule update failed' };
    callback();
    chromeApi.runtime.lastError = null;
    return true;
  }
  globalThis.chrome = chromeApi;
  await import(`../../extension/background.js?worker-test=${nextWorkerId++}`);
  return {
    writes,
    sendFrom: (message, sender) => new Promise((resolve) => sendMessageFrom(message, sender, resolve)),
    getDynamicRules: () => structuredClone(dynamicRules),
    getSessionRules: () => structuredClone(sessionRules),
    clearSessionRules: () => {
      sessionRules = [];
    },
    failNextRuleUpdate: (kind) => {
      failedRuleUpdate = kind;
    }
  };
}
