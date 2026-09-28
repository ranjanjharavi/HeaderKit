export function storageAreaGet(storageArea, query, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    storageArea.get(query, (result) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(result || {});
    });
  });
}

export function storageAreaSet(storageArea, value, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    storageArea.set(value, () => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function storageAreaRemove(storageArea, keys, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    storageArea.remove(keys, () => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function storageLocalGet(query, chromeApi = globalThis.chrome) {
  return storageAreaGet(chromeApi.storage.local, query, chromeApi);
}

export function storageLocalSet(value, chromeApi = globalThis.chrome) {
  return storageAreaSet(chromeApi.storage.local, value, chromeApi);
}

export function requestOriginPermission(origin, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.permissions.request({ origins: [origin] }, (granted) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

export function requestOriginPermissions(origins, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.permissions.request({ origins }, (granted) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

/**
 * Read once when a page loads so a profile switch can work out what it needs
 * without an await between the click and permissions.request, which would
 * lose the user gesture Chrome requires.
 */
export function getGrantedOrigins(chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.permissions.getAll((permissions) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(new Set(permissions?.origins || []));
    });
  });
}

export function removeOriginPermission(origin, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.permissions.remove({ origins: [origin] }, (removed) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(Boolean(removed));
    });
  });
}

export function getDynamicRules(chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.declarativeNetRequest.getDynamicRules((rules) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(rules || []);
    });
  });
}

export function updateDynamicRules(details, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.declarativeNetRequest.updateDynamicRules(details, () => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function sendRuntimeMessage(message, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.runtime.sendMessage(message, (response) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

export function getCurrentTab(chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(tabs?.[0] || null);
    });
  });
}

export function clearAlarm(name, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.alarms.clear(name, (wasCleared) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(Boolean(wasCleared));
    });
  });
}

export function createAlarm(name, alarmInfo, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.alarms.create(name, alarmInfo, () => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function queryTabs(query, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.tabs.query(query, (tabs) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(tabs || []);
    });
  });
}

export function createTab(details, chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.tabs.create(details, (tab) => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve(tab || null);
    });
  });
}

export function openOptionsPage(chromeApi = globalThis.chrome) {
  return new Promise((resolve, reject) => {
    chromeApi.runtime.openOptionsPage(() => {
      const error = getRuntimeError(chromeApi);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function getExtensionUrl(path, chromeApi = globalThis.chrome) {
  return chromeApi.runtime.getURL(path);
}

export function onStorageChanged(handler, chromeApi = globalThis.chrome) {
  chromeApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      handler(changes);
    }
  });
}

function getRuntimeError(chromeApi) {
  const message = chromeApi?.runtime?.lastError?.message;
  return message ? new Error(message) : null;
}
