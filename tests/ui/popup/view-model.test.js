import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import { createDefaultProfiles } from '../../../extension/shared/domain/profiles.js';
import { getActivationDisplay, getManagerLinkLabel, getManagerPath } from '../../../extension/popup/view-model.js';

const now = 2_000_000;
const profiles = [
  ...createDefaultProfiles(),
  { id: 'staging', name: 'Staging', createdAt: 1, defaultDurationMs: null }
];

test('popup activation summary keeps the common state compact', () => {
  const activation = createDefaultActivation();

  assert.deepEqual(getActivationDisplay(profiles, activation, now), {
    profileName: 'Default',
    appliedUntil: 'Until turned off'
  });
});

test('popup activation summary describes timers and browser-session scope', () => {
  const timed = {
    ...createDefaultActivation(),
    profileId: 'staging',
    lastProfileId: 'staging',
    expiresAt: now + 3_600_000,
    durationMs: 3_600_000
  };
  const sessionScoped = {
    ...timed,
    expiresAt: null,
    durationMs: null,
    untilBrowserClose: true
  };

  assert.deepEqual(getActivationDisplay(profiles, timed, now), {
    profileName: 'Staging',
    appliedUntil: '1h left'
  });
  assert.deepEqual(getActivationDisplay(profiles, sessionScoped, now), {
    profileName: 'Staging',
    appliedUntil: 'Chrome closes'
  });
});

test('popup activation summary makes a parked profile explicit', () => {
  const parked = {
    ...createDefaultActivation(),
    profileId: null,
    lastProfileId: 'staging'
  };

  assert.deepEqual(getActivationDisplay(profiles, parked, now), {
    profileName: 'Staging',
    appliedUntil: 'Paused'
  });
});

test('popup manager link describes profiles and the total rule count', () => {
  assert.equal(getManagerLinkLabel(0), 'Manage profiles and rules →');
  assert.equal(getManagerLinkLabel(1), 'Manage profiles and 1 rule →');
  assert.equal(getManagerLinkLabel(4), 'Manage profiles and all 4 rules →');
});

test('popup manager targets are built in one testable place', () => {
  assert.equal(getManagerPath(), 'options/index.html');
  assert.equal(getManagerPath({ section: 'active-setup' }), 'options/index.html#active-setup');
});
