import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultActivation } from '../../../extension/shared/domain/activation.js';
import {
  bindActivationEvents as bindOptionsActivation,
  renderMasterSwitch as renderOptionsSwitch,
  renderDurationField
} from '../../../extension/options/activation/controller.js';
import {
  bindActivationEvents as bindPopupActivation,
  renderMasterSwitch as renderPopupSwitch
} from '../../../extension/popup/activation/controller.js';
import { state as optionsState } from '../../../extension/options/state.js';
import { state as popupState } from '../../../extension/popup/state.js';
import { createUiHarness } from '../../helpers/ui-harness.js';
import { getNextTabIndex } from '../../../extension/shared/ui/ui.js';

test('tab navigation wraps and supports Home and End without changing unknown keys', () => {
  assert.equal(getNextTabIndex('ArrowLeft', 0, 4), 3);
  assert.equal(getNextTabIndex('ArrowRight', 3, 4), 0);
  assert.equal(getNextTabIndex('ArrowRight', 0, 4), 1);
  assert.equal(getNextTabIndex('Home', 2, 4), 0);
  assert.equal(getNextTabIndex('End', 1, 4), 3);
  assert.equal(getNextTabIndex('Enter', 2, 4), 2);
});

function resetState() {
  optionsState.activation = createDefaultActivation();
  optionsState.profiles = [{ id: 'default', name: 'Default' }];
  optionsState.rules = [{ id: 1, enabled: true }];
  popupState.headers.activation = createDefaultActivation();
  popupState.headers.profiles = optionsState.profiles;
}

test('UI dispatch snapshots listeners and removes one-time handlers before calling them', async (t) => {
  const harness = createUiHarness(t);
  const node = harness.element('event-target');
  const calls = [];
  const second = () => calls.push('second');
  const added = () => calls.push('added');
  node.addEventListener('change', async () => {
    calls.push('first');
    node.removeEventListener('change', second);
    node.addEventListener('change', added);
    await Promise.resolve();
    calls.push('first-finished');
  }, { once: true });
  node.addEventListener('change', second);
  await node.dispatch('change');
  assert.deepEqual(calls, ['first', 'first-finished', 'second']);
  await node.dispatch('change');
  assert.deepEqual(calls, ['first', 'first-finished', 'second', 'added']);
});

test('options pause commits activation and leaves saved rule flags intact', async (t) => {
  resetState();
  const harness = createUiHarness(t);
  let renders = 0;
  bindOptionsActivation({
    onChanged() { optionsState.activation = harness.getActivation(); renders++; renderOptionsSwitch(); },
    onResumeProfile() {}
  });
  await harness.element('masterSwitch').dispatch('click');
  assert.equal(optionsState.activation.masterEnabled, false);
  assert.equal(optionsState.rules[0].enabled, true);
  assert.deepEqual(harness.requests[0], { type: 'headerkit:activation:set-master', enabled: false });
  assert.equal(renders, 1);
  assert.equal(harness.element('masterPausedBanner').hidden, false);
});

test('options timer selection commits browser-session scope and refreshes radio state', async (t) => {
  resetState();
  const harness = createUiHarness(t);
  bindOptionsActivation({
    onChanged() { optionsState.activation = harness.getActivation(); renderDurationField(); },
    onResumeProfile() {}
  });
  harness.pills[3].checked = true;
  await harness.element('durationPills').dispatch('change', { target: harness.pills[3] });
  assert.equal(optionsState.activation.untilBrowserClose, true);
  assert.equal(optionsState.activation.expiresAt, null);
  assert.equal(harness.pills[3].checked, true);
  assert.equal(harness.element('expiryChip').hidden, true);
  assert.ok(harness.pills.every((pill) => !pill.disabled));
});

test('duration radios reject extra changes while committing and unlock after success', async (t) => {
  resetState();
  const harness = createUiHarness(t, { holdCommit: true });
  bindOptionsActivation({
    onChanged() { optionsState.activation = harness.getActivation(); },
    onResumeProfile() {}
  });
  renderDurationField();
  harness.pills[1].checked = true;
  const commit = harness.element('durationPills').dispatch('change', { target: harness.pills[1] });
  assert.ok(harness.pills.every((pill) => pill.disabled));
  harness.pills[2].checked = true;
  await harness.element('durationPills').dispatch('change', { target: harness.pills[2] });
  assert.equal(harness.requests.length, 1);
  harness.releaseCommit();
  await commit;
  assert.equal(harness.pills[1].checked, true);
  assert.equal(harness.pills[2].checked, false);
  assert.ok(harness.pills.every((pill) => !pill.disabled));
});

test('a rejected duration change restores the saved radio selection', async (t) => {
  resetState();
  const harness = createUiHarness(t, { failCommit: true });
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  bindOptionsActivation({ onChanged() { assert.fail('Rejected changes must not refresh state'); }, onResumeProfile() {} });
  renderDurationField();
  harness.pills[0].checked = false;
  harness.pills[1].checked = true;
  await harness.element('durationPills').dispatch('change', { target: harness.pills[1] });
  assert.equal(harness.pills[0].checked, true);
  assert.equal(harness.pills[1].checked, false);
  assert.ok(harness.pills.every((pill) => !pill.disabled));
  assert.equal(harness.element('activeSetupStatus').textContent, 'Commit rejected');
});

test('options resume delegates a parked profile to profile activation', async (t) => {
  resetState();
  const harness = createUiHarness(t);
  optionsState.activation = { ...createDefaultActivation(), profileId: null, lastProfileId: 'qa' };
  let resumedProfile;
  bindOptionsActivation({ onChanged() {}, onResumeProfile(id) { resumedProfile = id; } });
  await harness.element('resumeMasterBtn').dispatch('click');
  assert.equal(resumedProfile, 'qa');
  assert.equal(harness.requests.length, 0);
});

test('activation controls remain disabled until the worker commit finishes', async (t) => {
  resetState();
  const harness = createUiHarness(t, { holdCommit: true });
  bindOptionsActivation({ onChanged() {}, onResumeProfile() {} });
  const commit = harness.element('masterSwitch').dispatch('click');
  assert.equal(harness.element('masterSwitch').disabled, true);
  assert.equal(harness.element('resumeMasterBtn').disabled, true);
  harness.releaseCommit();
  await commit;
  assert.equal(harness.element('masterSwitch').disabled, false);
  assert.equal(harness.element('resumeMasterBtn').disabled, false);
});

test('popup pause refreshes the switch after a successful worker commit', async (t) => {
  resetState();
  const harness = createUiHarness(t);
  bindPopupActivation({ onChanged() { popupState.headers.activation = harness.getActivation(); renderPopupSwitch(); } });
  await harness.element('masterSwitch').dispatch('click');
  assert.equal(popupState.headers.activation.masterEnabled, false);
  assert.equal(harness.element('masterSwitch').getAttribute('aria-checked'), 'false');
  assert.equal(harness.element('masterSwitch').disabled, false);
});

test('a rejected popup commit preserves activation and restores usable controls', async (t) => {
  resetState();
  const harness = createUiHarness(t, { failCommit: true });
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  bindPopupActivation({ onChanged: renderPopupSwitch });
  await harness.element('masterSwitch').dispatch('click');
  assert.equal(popupState.headers.activation.masterEnabled, true);
  assert.equal(harness.element('masterSwitch').disabled, false);
  assert.equal(harness.element('headerStatus').textContent, 'Commit rejected');
  assert.equal(harness.element('headerStatus').classList.contains('error'), true);
});
