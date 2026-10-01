export function createActivationHarness(t, { failCommit = false, holdCommit = false } = {}) {
  const originals = {
    document: globalThis.document,
    chrome: globalThis.chrome,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };
  const elements = new Map();
  const requests = [];
  let pendingResponse;

  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const attributes = new Map();
    const classes = new Set();
    const handlers = new Map();
    const node = {
      id,
      disabled: false,
      hidden: false,
      textContent: '',
      dataset: {},
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name)
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      addEventListener: (name, handler) => handlers.set(name, handler),
      closest: () => node,
      focus() {},
      async dispatch(name, event = {}) {
        await handlers.get(name)({ target: node, ...event });
        // Duration handlers start a commit without returning its promise.
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
        const reply = () => callback(failCommit
          ? { ok: false, error: 'Commit rejected' }
          : { ok: true, activation: message.activation });
        if (holdCommit) pendingResponse = reply;
        else reply();
      }
    }
  };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  t.after(() => Object.assign(globalThis, originals));

  return { element, pills, requests, releaseCommit: () => pendingResponse() };
}
