import { applyActivationIntent } from '../../extension/background/state-commit.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';

async function dispatchHandlers(snapshot, listeners, event) {
  const entry = snapshot.next();
  if (entry.done) {
    return;
  }
  const [handler, options] = entry.value;
  if (options.once) {
    listeners.delete(handler);
  }
  await handler({ ...event });
  return dispatchHandlers(snapshot, listeners, event);
}

export function createUiHarness(t, { failCommit = false, holdCommit = false } = {}) {
  const originals = {
    document: globalThis.document,
    chrome: globalThis.chrome,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: globalThis.requestAnimationFrame
  };
  const elements = new Map();
  const requests = [];
  let pendingResponse;
  let activation = createDefaultActivation();

  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const attributes = new Map();
    const classes = new Set();
    const handlers = new Map();
    const node = {
      id,
      disabled: false,
      hidden: false,
      open: false,
      returnValue: '',
      textContent: '',
      dataset: {},
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle(name, enabled) {
          if (enabled ?? !classes.has(name)) classes.add(name);
          else classes.delete(name);
        }
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      removeAttribute: (name) => attributes.delete(name),
      querySelector: () => null,
      matches: () => false,
      addEventListener(name, handler, options = {}) {
        if (!handlers.has(name)) handlers.set(name, new Map());
        handlers.get(name).set(handler, options);
      },
      removeEventListener(name, handler) {
        handlers.get(name)?.delete(handler);
      },
      closest: (selector) => (selector === 'details' ? null : node),
      focus() {
        globalThis.document.activeElement = node;
      },
      showModal() {
        node.open = true;
      },
      close(value = '') {
        node.open = false;
        node.returnValue = value;
        void node.dispatch('close');
      },
      select() {},
      scrollIntoView() {},
      async dispatch(name, event = {}) {
        const listeners = handlers.get(name) || new Map();
        const snapshot = new Map(listeners);
        await dispatchHandlers(snapshot.entries(), listeners, { target: node, ...event });
        await Promise.resolve();
      }
    };
    elements.set(id, node);
    return node;
  }

  const pills = ['indefinite', '3600000', '28800000', 'session'].map((duration) => {
    const pill = element(`duration-${duration}`);
    pill.dataset.duration = duration;
    return pill;
  });
  globalThis.document = {
    getElementById: element,
    querySelectorAll: () => pills
  };
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message);
        const reply = () => {
          if (failCommit) {
            callback({ ok: false, error: 'Commit rejected' });
            return;
          }
          activation = applyActivationIntent(message, { activation, profileIds: new Set(['default', 'qa']) });
          callback({ ok: true, activation });
        };
        if (holdCommit) pendingResponse = reply;
        else reply();
      }
    }
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  t.after(() => Object.assign(globalThis, originals));

  return { element, pills, requests, releaseCommit: () => pendingResponse(), getActivation: () => activation };
}
