import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BADGE_ACTIVE_COLOR,
  BADGE_PAUSED_COLOR,
  resolveBadge
} from '../extension/background/badge.js';

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

test('a page ReqKit can never touch shows nothing', () => {
  ['chrome://extensions', 'about:blank', 'http://insecure.example.com/'].forEach((url) => {
    assert.deepEqual(resolveBadge(rules, on, { url }), { text: '', color: null }, url);
  });
});

test('an unreadable tab falls back to the profile-wide count', () => {
  assert.deepEqual(resolveBadge(rules, on, { url: undefined }), {
    text: '3',
    color: BADGE_ACTIVE_COLOR
  });
  assert.deepEqual(resolveBadge(rules, on), { text: '3', color: BADGE_ACTIVE_COLOR });
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
