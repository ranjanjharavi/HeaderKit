import assert from 'node:assert/strict';
import test from 'node:test';
import { applyActivationIntent, applyProfileIntent, commitState } from '../../extension/background/state-commit.js';
import { createDefaultActivation } from '../../extension/shared/domain/activation.js';
import { createDefaultProfile } from '../../extension/shared/domain/profiles.js';
import {
  ACTIVATION_MESSAGE_SET_MASTER,
  ACTIVATION_MESSAGE_SET_PROFILE,
  ACTIVATION_MESSAGE_SET_DURATION,
  PROFILE_MESSAGE_CREATE,
  PROFILE_MESSAGE_RENAME,
  PROFILE_MESSAGE_DUPLICATE,
  PROFILE_MESSAGE_DELETE
} from '../../extension/shared/runtime/messages.js';

function initialState() {
  return {
    profiles: [createDefaultProfile(), { id: 'staging', name: 'Staging' }],
    profileIds: new Set(['default', 'staging']),
    rules: [{ id: 1, domain: 'example.com', headerName: 'X-Test', headerValue: 'one', enabled: true, profileId: 'staging' }],
    activation: { ...createDefaultActivation(), profileId: 'staging', lastProfileId: 'staging' }
  };
}

test('profile intents create, rename and duplicate from current state with paused distinct-id rules', () => {
  const state = initialState();
  const created = applyProfileIntent({ type: PROFILE_MESSAGE_CREATE, name: 'Production' }, state);
  assert.equal(created.profiles.length, 3);
  assert.deepEqual(created.rules, state.rules);
  const renamed = applyProfileIntent({ type: PROFILE_MESSAGE_RENAME, id: 'staging', name: 'Test' }, state);
  assert.equal(renamed.profiles[1].name, 'Test');
  const copied = applyProfileIntent({ type: PROFILE_MESSAGE_DUPLICATE, id: 'staging', name: 'Copy' }, state);
  assert.equal(copied.rules[1].id, 2);
  assert.equal(copied.rules[1].enabled, false);
  assert.equal(copied.rules[1].profileId, copied.profile.id);
  assert.deepEqual(copied.activation, state.activation);
  assert.throws(() => applyProfileIntent({ type: PROFILE_MESSAGE_RENAME, id: 'missing', name: 'Lost' }, state), /no longer exists/);
  assert.throws(() => applyProfileIntent({ type: PROFILE_MESSAGE_CREATE, name: 'Staging' }, state), /already exists/);
});

test('deleting a profile removes its rules and activation references without activating parked rules', () => {
  const state = initialState();
  const defaultRule = { ...state.rules[0], id: 2, profileId: 'default' };
  state.rules.push(defaultRule);
  const originalState = structuredClone(state);
  const deleted = applyProfileIntent({ type: PROFILE_MESSAGE_DELETE, id: 'staging' }, state);
  assert.deepEqual(deleted.rules, [defaultRule], 'rules in other profiles stay unchanged');
  assert.deepEqual(state, originalState, 'source state stays unchanged');
  assert.equal(deleted.profiles.length, 1);
  assert.equal(deleted.activation.profileId, 'default');
  assert.equal(deleted.activation.lastProfileId, 'default');
  const parked = applyProfileIntent({ type: PROFILE_MESSAGE_DELETE, id: 'staging' }, {
    ...state, activation: { ...state.activation, profileId: null }
  });
  assert.deepEqual(parked.rules, [defaultRule]);
  assert.equal(parked.activation.profileId, null);
  assert.equal(parked.activation.lastProfileId, 'default');
  assert.throws(() => applyProfileIntent({ type: PROFILE_MESSAGE_DELETE, id: 'default' }, state), /cannot be deleted/);
});

test('state commit applies before one atomic storage write and restores DNR on storage failure', async () => {
  const state = initialState();
  for (const type of [PROFILE_MESSAGE_DELETE, PROFILE_MESSAGE_DUPLICATE]) {
    const nextState = applyProfileIntent({ type, id: 'staging', name: 'Copy' }, state);
    const events = [];
    await assert.rejects(commitState(nextState, state, {
      applyState: async (value) => events.push(value),
      storeState: async (value) => { events.push(value); throw new Error('Storage failed'); }
    }), /Storage failed/);
    assert.deepEqual(events, [nextState, nextState, state]);
    const writes = [];
    await commitState(nextState, state, {
      applyState: async () => {},
      storeState: async (value) => writes.push(value)
    });
    assert.deepEqual(writes, [nextState]);
  }
});

test('activation intents preserve current master state and reject stale profile references', () => {
  const state = initialState();
  state.activation.masterEnabled = false;
  const selected = applyActivationIntent({ type: ACTIVATION_MESSAGE_SET_PROFILE, profileId: 'default' }, state);
  assert.equal(selected.masterEnabled, false);
  assert.equal(selected.profileId, 'default');
  const timed = applyActivationIntent({ type: ACTIVATION_MESSAGE_SET_DURATION, durationMs: 60_000 }, state);
  assert.equal(timed.masterEnabled, false);
  assert.equal(timed.profileId, 'staging');
  assert.equal(timed.durationMs, 60_000);
  const resumed = applyActivationIntent({ type: ACTIVATION_MESSAGE_SET_MASTER, enabled: true }, { ...state, activation: timed });
  assert.equal(resumed.expiresAt, timed.expiresAt);
  assert.throws(() => applyActivationIntent({ type: ACTIVATION_MESSAGE_SET_PROFILE, profileId: 'missing' }, state), /no longer exists/);
});

test('state commit does not write storage when applying DNR fails', async () => {
  const state = initialState();
  let stored = false;
  await assert.rejects(commitState(state, state, {
    applyState: async () => { throw new Error('DNR failed'); },
    storeState: async () => { stored = true; }
  }), /DNR failed/);
  assert.equal(stored, false);
});