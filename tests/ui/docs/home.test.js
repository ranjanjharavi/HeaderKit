import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../docs/assets/home.js', import.meta.url), 'utf8');

function setup({ reduced = false, still = false, supported = true, imageReady = true } = {}) {
  const animations = [];
  const overlays = new Set();
  const requests = [];
  const document = { activeElement: null };
  function element() {
    const attributes = new Map();
    const classes = new Set();
    const listeners = new Map();
    return {
      hidden: false,
      disabled: false,
      textContent: '',
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      removeAttribute: (name) => attributes.delete(name),
      addEventListener: (name, callback) => listeners.set(name, callback),
      dispatch: (name, event) => listeners.get(name)?.(event),
      focus() {
        document.activeElement = this;
      },
      remove() {
        overlays.delete(this);
      },
      after(overlay) {
        overlays.add(overlay);
      },
      cloneNode() {
        const clone = element();
        clone.src = this.src;
        clone.setAttribute('id', 'gallery-image');
        return clone;
      },
      animate: supported
        ? (frames, options) => {
            let finish;
            let reject;
            const animation = {
              frames,
              options,
              finished: new Promise((resolve, fail) => {
                finish = resolve;
                reject = fail;
              }),
              finish: () => finish(),
              cancel() {
                this.cancelled = true;
                reject(new Error('Cancelled'));
              }
            };
            animations.push(animation);
            return animation;
          }
        : undefined
    };
  }
  const elements = new Map();
  for (const id of [
    'gallery-image',
    'image-loading',
    'gallery-status',
    'retry-screenshot',
    'gallery-title',
    'gallery-copy'
  ]) {
    elements.set(id, element());
  }
  const image = elements.get('gallery-image');
  image.src = 'assets/img/headerkit-rule-manager-screenshot.png';
  image.complete = imageReady;
  image.naturalWidth = imageReady ? 1280 : 0;
  const buttons = ['manager', 'scope', 'profiles', 'access', 'headers'].map((key) => {
    const button = element();
    button.dataset = { shot: key };
    button.setAttribute('aria-pressed', String(key === 'manager'));
    return button;
  });
  const preference = element();
  preference.matches = reduced;
  document.getElementById = (id) => elements.get(id);
  document.querySelectorAll = () => buttons;
  runInNewContext(source, {
    document,
    URLSearchParams,
    window: { matchMedia: () => preference, location: { search: still ? '?still' : '' } },
    Image: class {
      constructor() {
        requests.push(this);
      }
    }
  });
  return {
    image,
    buttons,
    preference,
    document,
    animations,
    overlays,
    requests,
    loading: elements.get('image-loading'),
    status: elements.get('gallery-status'),
    retry: elements.get('retry-screenshot'),
    title: elements.get('gallery-title'),
    select(key) {
      buttons.find((button) => button.dataset.shot === key).dispatch('click');
    }
  };
}

test('every gallery selection loads an existing image from the website image directory', () => {
  const view = setup({ reduced: true });
  const expected = {
    manager: 'headerkit-rule-manager-screenshot.png',
    scope: 'headerkit-request-scoping-screenshot.png',
    profiles: 'headerkit-manage-profiles-screenshot.png',
    access: 'headerkit-site-access-screenshot.png',
    headers: 'headerkit-headers-screenshot.png'
  };
  for (const [key, filename] of Object.entries(expected)) {
    view.select(key);
    const request = view.requests.at(-1);
    assert.equal(request.src, `assets/img/${filename}`);
    assert.ok(statSync(new URL(`../../../docs/${request.src}`, import.meta.url)).isFile());
    request.onload();
    assert.equal(view.image.src, request.src);
  }
});

test('gallery keeps the current screenshot while loading, then crossfades and cleans up', async () => {
  const view = setup();
  const previousSource = view.image.src;
  view.select('scope');
  assert.equal(view.image.src, previousSource);
  assert.equal(view.loading.hidden, true);
  assert.equal(view.buttons[0].getAttribute('aria-pressed'), 'true');
  view.requests[0].onload();
  assert.match(view.image.src, /request-scoping/);
  assert.match(view.image.alt, /rule editor/);
  assert.equal(view.title.textContent, 'A boundary for each rule.');
  assert.equal(view.buttons[1].getAttribute('aria-pressed'), 'true');
  const [overlay] = view.overlays;
  assert.equal(overlay.src, previousSource);
  assert.equal(overlay.getAttribute('id'), undefined);
  assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(overlay.alt, '');
  assert.equal(view.animations[0].options.duration, 280);
  view.animations[0].finish();
  await Promise.resolve();
  assert.equal(view.overlays.size, 0);
});

test('rapid gallery selections ignore stale loads and replace an active crossfade safely', async () => {
  const view = setup();
  view.select('scope');
  view.select('profiles');
  view.requests[0].onload();
  assert.match(view.image.src, /rule-manager/);
  assert.equal(view.animations.length, 0);
  view.requests[1].onload();
  view.select('access');
  view.requests[2].onload();
  assert.equal(view.animations[0].cancelled, true);
  await Promise.resolve();
  assert.equal(view.overlays.size, 1);
  assert.match(view.image.src, /site-access/);
  assert.equal(view.buttons[3].getAttribute('aria-pressed'), 'true');
  view.requests[0].onerror();
  assert.equal(view.status.classList.contains('is-error'), false);
  view.animations[1].finish();
  await Promise.resolve();
  assert.equal(view.overlays.size, 0);
});

test('failed screenshots preserve the last selection and retry restores focus', () => {
  const view = setup();
  const previousSource = view.image.src;
  view.select('headers');
  view.requests[0].onerror();
  assert.equal(view.image.src, previousSource);
  assert.equal(view.buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(view.retry.hidden, false);
  assert.equal(view.retry.disabled, false);
  view.retry.focus();
  view.retry.dispatch('click');
  view.requests[1].onload();
  assert.match(view.image.src, /headers-screenshot/);
  assert.equal(view.document.activeElement, view.buttons[4]);
  assert.equal(view.retry.hidden, true);
});

test('reduced motion, still mode, and unsupported animation swap screenshots immediately', () => {
  for (const options of [{ reduced: true }, { still: true }, { supported: false }]) {
    const view = setup(options);
    view.select('profiles');
    view.requests[0].onload();
    assert.match(view.image.src, /manage-profiles/);
    assert.equal(view.overlays.size, 0);
    assert.equal(view.animations.length, 0);
  }
});

test('enabling reduced motion removes an in-progress crossfade', async () => {
  const view = setup();
  view.select('scope');
  view.requests[0].onload();
  view.preference.matches = true;
  view.preference.dispatch('change', { matches: true });
  assert.equal(view.animations[0].cancelled, true);
  assert.equal(view.overlays.size, 0);
  view.select('access');
  view.requests[1].onload();
  await Promise.resolve();
  assert.equal(view.animations.length, 1);
  assert.match(view.image.src, /site-access/);
});

test('an unavailable initial image uses the existing loading state without fading broken content', () => {
  const view = setup({ imageReady: false });
  view.select('scope');
  assert.equal(view.loading.hidden, false);
  view.requests[0].onload();
  assert.equal(view.loading.hidden, true);
  assert.equal(view.overlays.size, 0);
  assert.equal(view.status.textContent, 'Request scope screenshot loaded.');
});
