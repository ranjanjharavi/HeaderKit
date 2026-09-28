import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultActivation,
  countLiveRules,
  deactivate,
  formatRemainingTime,
  getLiveRules,
  getRemainingMs,
  getTargetProfileId,
  isActivationExpired,
  isRuleLive,
  normalizeActivation,
  resolveActivation,
  setActivationDuration,
  setActiveProfile,
  setMasterEnabled,
  startBrowserSession
} from '../extension/shared/domain/activation.js';

const stagingRule = { id: 1, enabled: true, profileId: 'staging' };
const prodRule = { id: 2, enabled: true, profileId: 'prod' };
const pausedStagingRule = { id: 3, enabled: false, profileId: 'staging' };
const legacyRule = { id: 4, enabled: true };

const stagingActivation = { masterEnabled: true, profileId: 'staging' };

test('isRuleLive requires the master switch, the rule flag, and a profile match', () => {
  assert.equal(isRuleLive(stagingRule, stagingActivation), true);
  assert.equal(isRuleLive(prodRule, stagingActivation), false);
  assert.equal(isRuleLive(pausedStagingRule, stagingActivation), false);
  assert.equal(isRuleLive(stagingRule, { masterEnabled: false, profileId: 'staging' }), false);
  assert.equal(isRuleLive(stagingRule, { masterEnabled: true, profileId: null }), false);
});

test('rules written before profiles existed belong to the default profile', () => {
  assert.equal(isRuleLive(legacyRule, createDefaultActivation()), true);
  assert.equal(isRuleLive(legacyRule, stagingActivation), false);
});

test('live rule helpers filter and count consistently', () => {
  const rules = [stagingRule, prodRule, pausedStagingRule, legacyRule];

  assert.deepEqual(getLiveRules(rules, stagingActivation), [stagingRule]);
  assert.equal(countLiveRules(rules, stagingActivation), 1);
  assert.equal(countLiveRules(rules, { masterEnabled: false, profileId: 'staging' }), 0);
  assert.equal(countLiveRules(rules, createDefaultActivation()), 1);
});

test('normalizeActivation repairs unknown profiles but preserves an explicit null', () => {
  const profileIds = new Set(['default', 'staging']);

  assert.equal(normalizeActivation({ profileId: 'deleted' }, { profileIds }).profileId, 'default');
  assert.equal(normalizeActivation({ profileId: 'staging' }, { profileIds }).profileId, 'staging');
  assert.equal(normalizeActivation({ profileId: null }, { profileIds }).profileId, null);
  assert.deepEqual(normalizeActivation(undefined), createDefaultActivation());
  assert.equal(normalizeActivation({ expiresAt: -5 }).expiresAt, null);
  assert.equal(normalizeActivation({ masterEnabled: false }).masterEnabled, false);
});

test('the kill switch preserves the selected profile', () => {
  const paused = setMasterEnabled(stagingActivation, false);
  assert.equal(paused.masterEnabled, false);
  assert.equal(paused.profileId, 'staging');

  const resumed = setMasterEnabled(paused, true);
  assert.equal(resumed.masterEnabled, true);
  assert.equal(resumed.profileId, 'staging');
});

test('resuming after an expiry restores the last profile', () => {
  const expired = deactivate(stagingActivation);
  assert.equal(expired.profileId, null);
  assert.equal(expired.lastProfileId, 'staging');

  assert.equal(setMasterEnabled(expired, true).profileId, 'staging');
});

test('selecting a profile arms a fresh timer and disarms the previous one', () => {
  const now = 1_000_000;
  const timed = setActiveProfile(stagingActivation, 'staging', { durationMs: 60_000, now });
  assert.equal(timed.expiresAt, now + 60_000);

  const switched = setActiveProfile(timed, 'prod', { now });
  assert.equal(switched.profileId, 'prod');
  assert.equal(switched.expiresAt, null);
  assert.equal(switched.untilBrowserClose, false);
});

test('expiry deactivates the profile without touching any rule', () => {
  const now = 1_000_000;
  const timed = setActiveProfile(stagingActivation, 'staging', { durationMs: 60_000, now });

  assert.equal(isActivationExpired(timed, now + 59_999), false);
  assert.equal(isActivationExpired(timed, now + 60_000), true);
  assert.equal(getRemainingMs(timed, now + 20_000), 40_000);
  assert.equal(getRemainingMs(timed, now + 90_000), 0);

  const before = resolveActivation(timed, now + 10_000);
  assert.equal(before.changed, false);
  assert.equal(before.activation.profileId, 'staging');

  const after = resolveActivation(timed, now + 60_001);
  assert.equal(after.changed, true);
  assert.equal(after.activation.profileId, null);
  assert.equal(after.activation.lastProfileId, 'staging');
  assert.equal(after.activation.expiresAt, null);
});

test('an indefinite activation never expires', () => {
  const indefinite = setActiveProfile(stagingActivation, 'staging', { durationMs: null });

  assert.equal(indefinite.expiresAt, null);
  assert.equal(isActivationExpired(indefinite, Number.MAX_SAFE_INTEGER), false);
  assert.equal(getRemainingMs(indefinite), null);
});

test('a clock moved backwards only delays expiry, it never resurrects a profile', () => {
  const now = 1_000_000;
  const timed = setActiveProfile(stagingActivation, 'staging', { durationMs: 60_000, now });
  const expired = resolveActivation(timed, now + 60_001).activation;

  assert.equal(resolveActivation(timed, now - 500_000).changed, false);
  assert.equal(resolveActivation(expired, now - 500_000).activation.profileId, null);
});

test('a new browser session clears an until-Chrome-closes activation', () => {
  const sessionScoped = setActiveProfile(stagingActivation, 'staging', { untilBrowserClose: true });
  assert.equal(sessionScoped.untilBrowserClose, true);

  const restarted = startBrowserSession(sessionScoped);
  assert.equal(restarted.changed, true);
  assert.equal(restarted.activation.profileId, null);
  assert.equal(restarted.activation.lastProfileId, 'staging');

  assert.equal(startBrowserSession(stagingActivation).changed, false);
});

test('new rules target the selected profile, or the last one while paused', () => {
  assert.equal(getTargetProfileId(stagingActivation), 'staging');
  assert.equal(getTargetProfileId(deactivate(stagingActivation)), 'staging');
  assert.equal(getTargetProfileId(createDefaultActivation()), 'default');
  assert.equal(getTargetProfileId(null), 'default');
});

test('the chosen duration is recorded so a surface can restore the control', () => {
  const now = 1_000_000;
  const timed = setActivationDuration(stagingActivation, { durationMs: 3_600_000, now });

  assert.equal(timed.expiresAt, now + 3_600_000);
  assert.equal(timed.durationMs, 3_600_000);
  assert.equal(timed.profileId, 'staging', 'the selected profile is untouched');
  assert.equal(normalizeActivation(timed).durationMs, 3_600_000, 'survives a round trip');
});

test('clearing the duration disarms the timer', () => {
  const timed = setActivationDuration(stagingActivation, { durationMs: 3_600_000 });
  const cleared = setActivationDuration(timed, { durationMs: null });

  assert.equal(cleared.expiresAt, null);
  assert.equal(cleared.durationMs, null);
  assert.equal(cleared.untilBrowserClose, false);
});

test('an until-Chrome-closes choice carries no timestamp', () => {
  const sessionScoped = setActivationDuration(stagingActivation, { untilBrowserClose: true });

  assert.equal(sessionScoped.untilBrowserClose, true);
  assert.equal(sessionScoped.expiresAt, null);
  assert.equal(sessionScoped.durationMs, null);
});

test('a parked activation has nothing to time', () => {
  const parked = deactivate(stagingActivation);
  const attempted = setActivationDuration(parked, { durationMs: 3_600_000 });

  assert.equal(attempted.expiresAt, null);
  assert.equal(attempted.profileId, null);
});

test('a stale duration without an expiry is dropped', () => {
  assert.equal(normalizeActivation({ profileId: 'staging', durationMs: 3_600_000 }).durationMs, null);
});

test('remaining time reads coarsely, never to the second', () => {
  assert.equal(formatRemainingTime(42 * 60_000), '42 min');
  assert.equal(formatRemainingTime(59 * 60_000 + 30_000), '1h', 'rounds up into hours');
  assert.equal(formatRemainingTime(60 * 60_000), '1h');
  assert.equal(formatRemainingTime(59 * 60_000), '59 min');
  assert.equal(formatRemainingTime(61 * 60_000), '1h 1m');
  assert.equal(formatRemainingTime(7 * 3_600_000 + 20 * 60_000), '7h 20m');
  assert.equal(formatRemainingTime(8 * 3_600_000), '8h');
  assert.equal(formatRemainingTime(0), 'less than a minute');
  assert.equal(formatRemainingTime(null), 'less than a minute');
});
