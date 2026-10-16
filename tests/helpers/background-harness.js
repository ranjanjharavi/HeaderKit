let nextWorkerId = 0;

function createEvent() {
  const listeners = [];
  return {
    addListener: (listener) => listeners.push(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args))
  };
}

export async function installBackgroundHarness(chromeApi) {
  const messages = [];
  const writes = [];
  let dynamicRules = [];
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
  chromeApi.runtime.onMessage = { addListener: (listener) => messages.push(listener) };
  chromeApi.runtime.onInstalled = createEvent();
  chromeApi.runtime.onStartup = createEvent();
  chromeApi.runtime.sendMessage = (message, callback) => {
    const handled = messages.some((listener) => listener(message, { id: 'reqkit-test' }, callback));
    if (!handled) {
      callback(undefined);
    }
  };
  chromeApi.permissions.onAdded = createEvent();
  chromeApi.permissions.onRemoved = createEvent();
  for (const [method, event] of [['request', 'onAdded'], ['remove', 'onRemoved']]) {
    const original = chromeApi.permissions[method]?.bind(chromeApi.permissions);
    if (original) {
      chromeApi.permissions[method] = (details, callback) => original(details, (changed) => {
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
  chromeApi.tabs.onUpdated = createEvent();
  chromeApi.tabs.onActivated = createEvent();
  chromeApi.declarativeNetRequest = {
    getDynamicRules: (callback) => callback(structuredClone(dynamicRules)),
    updateDynamicRules: ({ removeRuleIds, addRules }, callback) => {
      dynamicRules = [...dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)), ...structuredClone(addRules)];
      callback();
    }
  };
  globalThis.chrome = chromeApi;
  await import(`../../extension/background.js?worker-test=${nextWorkerId++}`);
  return { writes, getDynamicRules: () => structuredClone(dynamicRules) };
}