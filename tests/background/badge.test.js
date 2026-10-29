import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BADGE_ACTIVE_COLOR,
  BADGE_PAUSED_COLOR,
  createBadgeController,
  resolveBadge
} from '../../extension/background/badge.js';

const rules = [
  { id: 1, domain: 'api.example.com', headerName: 'X-Auth', headerValue: 'a', enabled: true, profileId: 'default' },
  { id: 2, domain: 'api.example.com', headerName: 'X-Debug', headerValue: 'b', enabled: true, profileId: 'default' },
  { id: 3, domain: 'api.example.com', headerName: 'X-Trace', headerValue: 'c', enabled: false, profileId: 'default' },
  { id: 4, domain: 'cdn.example.net', headerName: 'X-Cache', headerValue: 'd', enabled: true, profileId: 'default' },
  { id: 5, domain: 'api.example.com', headerName: 'X-Env', headerValue: 'e', enabled: true, profileId: 'staging' }
];

const on = { masterEnabled: true, profileId: 'default', lastProfileId: 'default' };
const paused = { masterEnabled: false, profileId: 'default', lastProfileId: 'default' };
const expired = { masterEnabled: true, profileId: null, lastProfileId: 'default' };

test('badge jobs coalesce per tab and use targeted reads when no tab is supplied', async () => {
  const calls = [];
  const controller = createBadgeController({
    getState: async () => ({ rules, activation: on, grantedOrigins: new Set(['https://api.example.com/*']) }),
    queryTabs: async () => { throw new Error('Unexpected query'); },
    getTab: async (tabId) => { calls.push(['get', tabId]); return { id: tabId, url: 'https://api.example.com/' }; },
    action: {
      setBadgeText: async (details) => calls.push(['text', details]),
      setBadgeBackgroundColor: async () => {}
    },
    onError: (error) => { throw error; }
  });
  controller.refreshTab(7, { url: 'https://api.example.com/' });
  controller.refreshTab(7, { url: 'https://unrelated.example.org/' });
  await controller.whenIdle();
  assert.deepEqual(calls.filter(([, details]) => details?.tabId === 7), [['text', { tabId: 7, text: '' }]]);
  const count = calls.length;
  controller.refreshTab(8);
  await controller.whenIdle();
  assert.deepEqual(calls.slice(count), [['get', 8], ['text', { tabId: 8, text: '2' }]]);
});

test('unchanged badges are skipped and unreadable tabs inherit the changing default', async () => {
  let activation = on;
  let tabs = [{ id: 7, url: 'https://api.example.com/' }, { id: 8 }];
  const texts = [];
  const colors = [];
  const controller = createBadgeController({
    getState: async () => ({ rules, activation, grantedOrigins: new Set(['https://api.example.com/*']) }),
    queryTabs: async () => tabs,
    getTab: async () => null,
    action: {
      setBadgeText: async (details) => texts.push(details),
      setBadgeBackgroundColor: async (details) => colors.push(details)
    },
    onError: (error) => { throw error; }
  });
  await controller.refresh();
  await controller.whenIdle();
  assert.deepEqual(new Map(texts.map(({ tabId, text }) => [tabId, text])), new Map([[undefined, 'on'], [7, '2'], [8, null]]));
  assert.deepEqual(colors, [{ color: BADGE_ACTIVE_COLOR }]);
  texts.length = 0;
  colors.length = 0;
  await controller.refresh();
  await controller.whenIdle();
  assert.deepEqual(texts, []);
  assert.deepEqual(colors, []);
  activation = paused;
  await controller.refresh();
  await controller.whenIdle();
  assert.deepEqual(new Map(texts.map(({ tabId, text }) => [tabId, text])), new Map([[undefined, 'off'], [7, 'off']]));
  assert.deepEqual(colors, [{ color: BADGE_PAUSED_COLOR }]);
  tabs = [{ id: 7 }, { id: 8 }];
  texts.length = 0;
  await controller.refresh();
  await controller.whenIdle();
  assert.deepEqual(texts, [{ tabId: 7, text: null }]);
  controller.removeTab(7);
  controller.refreshTab(7, { url: 'https://api.example.com/' });
  await controller.whenIdle();
  assert.deepEqual(texts.at(-1), { tabId: 7, text: 'off' });
});

test('a delayed sweep cannot repaint a stale URL over a newer navigation', async () => {
  let releaseQuery;
  let markQueryStarted;
  const queryStarted = new Promise((resolve) => { markQueryStarted = resolve; });
  const texts = [];
  const controller = createBadgeController({
    getState: async () => ({ rules, activation: on, grantedOrigins: new Set(['https://api.example.com/*']) }),
    queryTabs: () => new Promise((resolve) => {
      releaseQuery = () => resolve([{ id: 7, url: 'https://api.example.com/' }]);
      markQueryStarted();
    }),
    getTab: async () => null,
    action: {
      setBadgeText: async (details) => texts.push(details),
      setBadgeBackgroundColor: async () => {}
    },
    onError: (error) => { throw error; }
  });
  controller.refresh();
  await queryStarted;
  await controller.refreshTab(7, { url: 'https://unrelated.example.net/' });
  releaseQuery();
  await controller.whenIdle();
  assert.deepEqual(texts.filter(({ tabId }) => tabId === 7), [{ tabId: 7, text: '' }]);
});

test('badge refresh returns without waiting for a stalled paint and converges on newer state', async () => {
  let activation = on;
  let releasePaint;
  let markPaintStarted;
  const paintStarted = new Promise((resolve) => { markPaintStarted = resolve; });
  const texts = [];
  const controller = createBadgeController({
    getState: async () => ({ rules, activation, grantedOrigins: new Set(['https://api.example.com/*']) }),
    queryTabs: async () => [{ id: 7, url: 'https://api.example.com/' }],
    getTab: async () => null,
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async ({ tabId, text }) => {
        texts.push([tabId, text]);
        if (tabId === 7 && !releasePaint) {
          await new Promise((resolve) => { releasePaint = resolve; markPaintStarted(); });
        }
      }
    },
    onError: (error) => { throw error; }
  });
  await controller.refresh();
  await paintStarted;
  activation = paused;
  await controller.refresh();
  releasePaint();
  await controller.whenIdle();
  assert.deepEqual(texts.filter(([tabId]) => tabId === 7).at(-1), [7, 'off']);
});

test('closing a tab cancels pending paints and failed paints stay retryable', async () => {
  let releaseTab;
  let markReadStarted;
  let failPaint = true;
  const readStarted = new Promise((resolve) => { markReadStarted = resolve; });
  const texts = [];
  const errors = [];
  const controller = createBadgeController({
    getState: async () => ({ rules, activation: on, grantedOrigins: new Set(['https://api.example.com/*']) }),
    queryTabs: async () => [],
    getTab: () => new Promise((resolve) => {
      releaseTab = () => resolve({ id: 7, url: 'https://api.example.com/' });
      markReadStarted();
    }),
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async (details) => {
        if (details.tabId === 7 && failPaint) {
          failPaint = false;
          throw new Error('Paint failed');
        }
        texts.push(details);
      }
    },
    onError: (error) => { errors.push(error.message); }
  });
  const pending = controller.refreshTab(7);
  await readStarted;
  controller.removeTab(7);
  releaseTab();
  await pending;
  await controller.whenIdle();
  assert.deepEqual(texts.filter(({ tabId }) => tabId === 7), []);
  assert.deepEqual(errors, []);
  await controller.refreshTab(7, { url: 'https://api.example.com/' });
  assert.deepEqual(errors, ['Paint failed']);
  await controller.refreshTab(7, { url: 'https://api.example.com/' });
  await controller.whenIdle();
  assert.deepEqual(texts.filter(({ tabId }) => tabId === 7), [{ tabId: 7, text: '2' }]);
});

test('a readable tab gets the count for that host only', () => {
  assert.deepEqual(resolveBadge(rules, on, { url: 'https://api.example.com/v2/orders' }), {
    text: '2',
    color: BADGE_ACTIVE_COLOR
  });

  assert.deepEqual(resolveBadge(rules, on, { url: 'https://cdn.example.net/logo.png' }), {
    text: '1',
    color: BADGE_ACTIVE_COLOR
  });
});

test('a host with no rules shows nothing', () => {
  assert.deepEqual(resolveBadge(rules, on, { url: 'https://unrelated.example.org/' }), {
    text: '',
    color: null
  });
});

test('a page HeaderKit can never touch shows nothing', () => {
  ['chrome://extensions', 'about:blank', 'http://insecure.example.com/'].forEach((url) => {
    assert.deepEqual(resolveBadge(rules, on, { url }), { text: '', color: null }, url);
  });
});

test('an unreadable tab shows neutral profile activation instead of a count', () => {
  assert.deepEqual(resolveBadge(rules, on, { url: undefined }), {
    text: 'on',
    color: BADGE_ACTIVE_COLOR
  });
  assert.deepEqual(resolveBadge(rules, on), { text: 'on', color: BADGE_ACTIVE_COLOR });
  assert.deepEqual(resolveBadge(rules, on, { url: null }), { text: 'on', color: BADGE_ACTIVE_COLOR });
  assert.deepEqual(resolveBadge([], on), { text: '', color: null });
});

test('rules in another profile are not counted', () => {
  const stagingOn = { masterEnabled: true, profileId: 'staging', lastProfileId: 'staging' };

  assert.deepEqual(resolveBadge(rules, stagingOn, { url: 'https://api.example.com/' }), {
    text: '1',
    color: BADGE_ACTIVE_COLOR
  });
});

test('pausing reports off, per host', () => {
  assert.deepEqual(resolveBadge(rules, paused, { url: 'https://api.example.com/' }), {
    text: 'off',
    color: BADGE_PAUSED_COLOR
  });
  assert.deepEqual(resolveBadge(rules, paused), { text: 'off', color: BADGE_PAUSED_COLOR });
});

test('an elapsed timer reports off just like the master switch', () => {
  assert.deepEqual(resolveBadge(rules, expired, { url: 'https://api.example.com/' }), {
    text: 'off',
    color: BADGE_PAUSED_COLOR
  });
});

test('pausing stays quiet where there was nothing to apply', () => {
  assert.deepEqual(resolveBadge(rules, paused, { url: 'https://unrelated.example.org/' }), {
    text: '',
    color: null
  });
  assert.deepEqual(resolveBadge([], paused), { text: '', color: null });
});

test('a host whose only rules are already off stays quiet when paused', () => {
  const onlyDisabled = [{ id: 9, domain: 'quiet.example.com', headerName: 'X-A', headerValue: 'v', enabled: false, profileId: 'default' }];

  assert.deepEqual(resolveBadge(onlyDisabled, on, { url: 'https://quiet.example.com/' }), { text: '', color: null });
  assert.deepEqual(resolveBadge(onlyDisabled, paused, { url: 'https://quiet.example.com/' }), { text: '', color: null });
});
