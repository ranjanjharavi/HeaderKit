import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../docs/assets/motion.js', import.meta.url), 'utf8');

function element(motion) {
  const classes = new Set();
  const styles = new Map();
  const listeners = new Map();
  return {
    dataset: motion ? { motion } : {},
    children: [],
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    style: {
      setProperty: (name, value) => styles.set(name, value),
      removeProperty: (name) => styles.delete(name),
      getPropertyValue: (name) => styles.get(name)
    },
    hasAttribute(name) {
      if (name === 'data-motion') return Boolean(this.dataset.motion);
      return name === 'data-motion-group' && Boolean(this.dataset.motionGroup);
    },
    removeAttribute(name) {
      if (name === 'data-motion') delete this.dataset.motion;
    },
    querySelector() { return this.image || null; },
    querySelectorAll() { return this.children; },
    closest(selector) {
      let node = this;
      while (node) {
        if (selector === '[data-motion]' && node.dataset.motion) return node;
        if (selector === '[data-motion-group]' && node.dataset.motionGroup) return node;
        node = node.parent;
      }
      return null;
    },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatch(name, event = {}) {
      for (const callback of [...(listeners.get(name) || [])]) {
        callback({ target: this, currentTarget: this, ...event });
      }
    }
  };
}

function setup({ reduced = false, still = false, supported = true, imageReady = true, failObserver = false } = {}) {
  const root = element();
  const preference = element();
  preference.matches = reduced;
  const intro = Array.from({ length: 7 }, () => element('intro'));
  const cards = [element('card'), element('card'), element('card')];
  const list = element();
  list.children = cards;
  const group = element();
  group.dataset.motionGroup = 'product';
  const image = element();
  image.complete = imageReady;
  const frame = element('image');
  frame.image = image;
  group.children = [element('up'), frame, element('up')];
  group.children.forEach((child) => { child.parent = group; });
  const frames = [];
  let observer;
  class Observer {
    constructor(callback, options) {
      if (failObserver) throw new Error('Observer unavailable');
      this.callback = callback;
      this.options = options;
      this.targets = new Set();
      this.removed = new Set();
      observer = this;
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); this.removed.add(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    enter(target, ratio = .3) {
      this.callback([{ target, isIntersecting: true, intersectionRatio: ratio }]);
    }
  }
  const document = element();
  document.documentElement = root;
  document.readyState = 'loading';
  document.querySelectorAll = (selector) => {
    if (selector === '[data-motion="intro"]') return intro;
    if (selector === '[data-motion-group]') return [group];
    if (selector === '.guide-list') return [list];
    return [];
  };
  const context = {
    document,
    URLSearchParams,
    IntersectionObserver: Observer,
    requestAnimationFrame: (callback) => frames.push(callback),
    window: {
      matchMedia: () => preference,
      IntersectionObserver: supported ? Observer : undefined,
      location: { search: still ? '?still' : '' }
    }
  };
  runInNewContext(source, context);
  return {
    root, document, preference, intro, cards, group, frame, image, frames,
    initialize() { document.dispatch('DOMContentLoaded'); },
    getObserver() { return observer; },
    tick() { frames.shift()?.(); }
  };
}

test('hero starts empty, staggers in reading order, then releases its controls', () => {
  const view = setup();
  assert.ok(view.root.classList.contains('motion-enabled'));
  view.initialize();
  assert.equal(view.intro[0].style.getPropertyValue('--motion-delay'), '0ms');
  assert.equal(view.intro[6].style.getPropertyValue('--motion-delay'), '360ms');
  view.tick();
  assert.equal(view.root.classList.contains('motion-entered'), false);
  view.tick();
  assert.ok(view.root.classList.contains('motion-entered'));
  assert.equal(view.frames.length, 0);
  const control = view.intro[6];
  control.dispatch('transitionend', { propertyName: 'opacity' });
  assert.equal(control.dataset.motion, 'intro');
  control.dispatch('transitionend', { propertyName: 'transform' });
  assert.equal(control.dataset.motion, undefined);
  assert.equal(control.style.getPropertyValue('--motion-delay'), undefined);
});

test('visual sections reveal once at thirty percent with local stagger', () => {
  const view = setup();
  view.initialize();
  const observer = view.getObserver();
  assert.equal(observer.options.threshold, .3);
  assert.equal(view.cards[0].style.getPropertyValue('--motion-delay'), '0ms');
  assert.equal(view.cards[2].style.getPropertyValue('--motion-delay'), '170ms');
  observer.enter(view.cards[0], .1);
  assert.equal(view.cards[0].classList.contains('is-revealed'), false);
  observer.enter(view.cards[0]);
  assert.ok(view.cards[0].classList.contains('is-revealed'));
  assert.ok(observer.removed.has(view.cards[0]));
  observer.enter(view.group);
  assert.ok(view.group.children.every((child) => child.classList.contains('is-revealed')));
  assert.ok(observer.removed.has(view.group));
});

for (const event of ['load', 'error']) {
  test(`screenshot ${event} resolves its veil without moving or changing the image`, () => {
    const view = setup({ imageReady: false });
    view.initialize();
    view.getObserver().enter(view.group);
    assert.equal(view.frame.classList.contains('is-revealed'), false);
    assert.ok(view.group.children[0].classList.contains('is-revealed'));
    view.image.dispatch(event);
    assert.ok(view.frame.classList.contains('is-revealed'));
    assert.equal(view.image.style.getPropertyValue('transform'), undefined);
    assert.equal(view.image.src, undefined);
  });
}

test('keyboard focus immediately exposes a pending link and cancels its entrance', () => {
  const view = setup();
  view.initialize();
  const child = element();
  child.parent = view.intro[0];
  view.document.dispatch('focusin', { target: child });
  assert.equal(view.intro[0].dataset.motion, undefined);
  view.document.dispatch('focusin', { target: view.cards[2] });
  assert.ok(view.cards[2].classList.contains('is-revealed'));
  assert.equal(view.cards[2].style.getPropertyValue('--motion-delay'), '0ms');
  assert.ok(view.getObserver().removed.has(view.cards[2]));
});

test('interacting with gallery controls exposes the whole product panel before its scroll threshold', () => {
  for (const event of ['focusin', 'pointerdown']) {
    const view = setup();
    view.initialize();
    const button = element();
    button.parent = view.group.children[0];
    view.document.dispatch(event, { target: button });
    assert.ok(view.group.children.every((child) => child.classList.contains('is-revealed')));
    assert.ok(view.group.children.every((child) => child.classList.contains('motion-instant')));
    assert.ok(view.group.children.every((child) => child.style.getPropertyValue('--motion-delay') === '0ms'));
    assert.ok(view.getObserver().removed.has(view.group));
  }
});

test('reduced motion, still mode, and unsupported observers keep the complete static page', () => {
  for (const options of [{ reduced: true }, { still: true }, { supported: false }]) {
    const view = setup(options);
    view.initialize();
    assert.equal(view.root.classList.contains('motion-enabled'), false);
    assert.equal(view.getObserver(), undefined);
    assert.equal(view.frames.length, 0);
  }
});

test('turning on reduced motion cancels both pending and active initialization', () => {
  for (const initialized of [false, true]) {
    const view = setup();
    if (initialized) view.initialize();
    view.preference.dispatch('change', { matches: true });
    if (!initialized) view.initialize();
    view.tick();
    view.tick();
    assert.equal(view.root.classList.contains('motion-enabled'), false);
    assert.equal(view.root.classList.contains('motion-entered'), false);
    if (initialized) assert.ok(view.getObserver().disconnected);
  }
});

test('initialization errors expose the page instead of leaving its intro hidden', () => {
  const view = setup({ failObserver: true });
  view.initialize();
  assert.equal(view.root.classList.contains('motion-enabled'), false);
  assert.equal(view.root.classList.contains('motion-entered'), false);
});
