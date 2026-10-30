import assert from 'node:assert/strict';
import test from 'node:test';
import { bindProfileEvents, activateProfile, renderProfiles } from '../../../extension/options/profiles/controller.js';
import { createProfileActions } from '../../../extension/options/profiles/actions.js';
import { state } from '../../../extension/options/state.js';
import { createDefaultActivation, getTargetProfileId } from '../../../extension/shared/domain/activation.js';
import { applyProfileIntent, applyActivationIntent } from '../../../extension/background/state-commit.js';
import { createBackupFixture } from '../../helpers/backup.js';
import { createUiHarness } from '../../helpers/ui-harness.js';

async function setup(t) {
  const harness = createUiHarness(t);
  t.mock.method(console, 'error', () => {});
  const fixture = createBackupFixture();
  let stored = { profiles: fixture.profiles, rules: fixture.rules, activation: createDefaultActivation() };
  const grants = new Set(['https://api.example.com/*']);
  Object.assign(state, structuredClone(stored), { grantedOrigins: new Set(grants) });
  const messages = [];
  const calls = [];
  const actionButtons = new Map();
  function actionButton(action, id) {
    const key = `${action}-${id}`;
    if (!actionButtons.has(key)) {
      const button = harness.element(key);
      button.dataset = { profileAction: action, id };
      button.isConnected = true;
      actionButtons.set(key, button);
    }
    return actionButtons.get(key);
  }
  function tabs() {
    return state.profiles.map((profile) => {
      const tab = harness.element(`tab-${profile.id}`);
      tab.dataset.profileTab = profile.id;
      tab.setAttribute('aria-selected', String(profile.id === getTargetProfileId(state.activation)));
      return tab;
    });
  }
  document.querySelectorAll = (selector) =>
    selector.startsWith('#profileTabs')
      ? tabs()
      : selector.startsWith('#profileList')
        ? state.profiles.flatMap((profile) =>
            ['rename', 'duplicate', 'delete'].map((action) => actionButton(action, profile.id))
          )
        : [];
  harness.element('profileTabs').querySelectorAll = tabs;
  harness.element('profileEditorForm').reset = () => {
    harness.element('profileNameInput').value = '';
  };
  chrome.runtime.sendMessage = (message, callback) => {
    calls.push('intent');
    messages.push(message);
    const snapshot = { ...stored, profileIds: new Set(stored.profiles.map((profile) => profile.id)) };
    if (message.type.startsWith('headerkit:profiles:')) {
      stored = applyProfileIntent(message, snapshot);
      callback({ ok: true, ...stored });
    } else {
      stored = { ...stored, activation: applyActivationIntent(message, snapshot) };
      callback({ ok: true, activation: stored.activation });
    }
  };
  chrome.permissions = {
    request({ origins }, callback) {
      calls.push('request');
      origins.forEach((origin) => grants.add(origin));
      callback(true);
    },
    getAll(callback) {
      calls.push('read-grants');
      callback({ origins: [...grants] });
    }
  };
  const refresh = async () => {
    calls.push('refresh');
    Object.assign(state, structuredClone(stored));
    renderProfiles();
  };
  bindProfileEvents({ onChanged: refresh });
  renderProfiles();
  await harness.element('manageProfilesBtn').dispatch('click');
  return { ...harness, messages, calls, actionButton, tabs, getStored: () => stored };
}

async function flush() {
  await new Promise(setImmediate);
}

async function submit(harness, name) {
  harness.element('profileNameInput').value = name;
  await harness.element('profileEditorForm').dispatch('submit', { preventDefault() {} });
}

test('profile rendering escapes names and maintains tab/panel labels and rule counts', async (t) => {
  const harness = await setup(t);
  state.profiles[1].name = '<QA & "review">';
  state.activation.profileId = 'qa';
  renderProfiles();
  const tabs = harness.element('profileTabs').innerHTML;
  assert.match(tabs, /id="profileTab-1"[^>]*aria-selected="true"[^>]*aria-controls="profilePanel"[^>]*tabindex="0"/);
  assert.equal(harness.element('profilePanel').getAttribute('aria-labelledby'), 'profileTab-1');
  assert.match(tabs, /&lt;QA &amp; &quot;review&quot;&gt;/);
  assert.doesNotMatch(tabs, /<QA/);
  assert.match(harness.element('profileList').innerHTML, /2 rules/);
  assert.doesNotMatch(harness.element('profileList').innerHTML, /data-profile-action="delete" data-id="default"/);
});

test('closing the profile manager clears editor state and empty renders remove stale panel labels', async (t) => {
  const harness = await setup(t);
  await harness.element('newProfileBtn').dispatch('click');
  await harness.element('closeProfileManagerBtn').dispatch('click');
  await flush();
  assert.equal(harness.element('profileManagerDialog').open, false);
  assert.equal(harness.element('profileEditorForm').hidden, true);
  await submit(harness, 'Hidden draft');
  assert.deepEqual(harness.messages, []);
  state.profiles = [];
  renderProfiles();
  assert.equal(harness.element('profilePanel').getAttribute('aria-labelledby'), undefined);
});

test('creating validates locally, preserves the draft on failure, and returns to the new profile action on success', async (t) => {
  const harness = await setup(t);
  await harness.element('newProfileBtn').dispatch('click');
  assert.equal(harness.element('profileEditorForm').hidden, false);
  assert.equal(document.activeElement, harness.element('profileNameInput'));
  await submit(harness, ' ');
  assert.deepEqual(harness.messages, []);
  assert.equal(harness.element('profileNameInput').getAttribute('aria-invalid'), 'true');
  await harness.element('profileNameInput').dispatch('input');
  assert.equal(harness.element('profileEditorError').hidden, true);
  await submit(harness, '  Review  ');
  assert.equal(harness.messages[0].type, 'headerkit:profiles:create');
  assert.equal(harness.messages[0].name, 'Review');
  const created = state.profiles.find((profile) => profile.name === 'Review');
  assert.ok(created);
  assert.equal(state.activation.profileId, 'default');
  assert.equal(harness.element('profileEditorForm').hidden, true);
  assert.equal(document.activeElement, harness.actionButton('rename', created.id));
  assert.equal(harness.element('profileStatus').textContent, 'Created Review.');
});

test('unchanged rename avoids a commit and cancelling an editor restores its initiating control', async (t) => {
  const harness = await setup(t);
  const button = harness.actionButton('rename', 'qa');
  await harness.element('profileList').dispatch('click', { target: button });
  assert.equal(harness.element('profileNameInput').value, 'QA');
  await submit(harness, 'QA');
  assert.deepEqual(harness.messages, []);
  assert.equal(document.activeElement, button);
  await harness.element('profileList').dispatch('click', { target: button });
  await harness.element('cancelProfileEditorBtn').dispatch('click');
  assert.equal(harness.element('profileEditorForm').hidden, true);
  assert.equal(document.activeElement, button);
});

test('rename and duplicate preserve profile semantics and explain paused copied rules', async (t) => {
  const harness = await setup(t);
  await harness.element('profileList').dispatch('click', { target: harness.actionButton('rename', 'qa') });
  await submit(harness, 'Quality');
  assert.equal(state.profiles.find((profile) => profile.id === 'qa').name, 'Quality');
  assert.equal(harness.element('profileStatus').textContent, 'Renamed to Quality.');
  await harness.element('profileList').dispatch('click', { target: harness.actionButton('duplicate', 'qa') });
  assert.match(
    harness.element('profileManagerDescription').textContent,
    /Copied rules start paused and remain editable/
  );
  await submit(harness, 'Quality copy');
  const copy = state.profiles.find((profile) => profile.name === 'Quality copy');
  assert.equal(state.rules.filter((rule) => rule.profileId === copy.id).length, 2);
  assert.ok(state.rules.filter((rule) => rule.profileId === copy.id).every((rule) => !rule.enabled));
  assert.equal(
    harness.element('profileStatus').textContent,
    'Copied 2 rules into Quality copy. They remain paused and editable.'
  );
  assert.equal(document.activeElement, harness.actionButton('duplicate', 'qa'));
});

test('saving holds its busy state until the commit settles and failures preserve the editor draft', async (t) => {
  const harness = await setup(t);
  await harness.element('newProfileBtn').dispatch('click');
  let release;
  chrome.runtime.sendMessage = (_message, callback) => {
    release = () => callback({ ok: false, error: 'Commit rejected' });
  };
  const saving = submit(harness, 'Draft profile');
  await Promise.resolve();
  assert.equal(harness.element('saveProfileEditorBtn').disabled, true);
  assert.equal(harness.element('saveProfileEditorBtn').textContent, 'Saving…');
  release();
  await saving;
  assert.equal(harness.element('saveProfileEditorBtn').disabled, false);
  assert.equal(harness.element('saveProfileEditorBtn').textContent, 'Create profile');
  assert.equal(harness.element('profileEditorForm').hidden, false);
  assert.equal(harness.element('profileNameInput').value, 'Draft profile');
  assert.equal(harness.element('profileEditorError').textContent, 'Commit rejected');
  assert.equal(document.activeElement, harness.element('profileNameInput'));
});

test('profile deletion waits for product confirmation and never deletes Default', async (t) => {
  const harness = await setup(t);
  await harness.element('profileList').dispatch('click', { target: harness.actionButton('delete', 'default') });
  assert.equal(harness.element('confirmationDialog').open, false);
  await harness.element('profileList').dispatch('click', { target: harness.actionButton('delete', 'qa') });
  assert.equal(harness.element('confirmationDialog').open, true);
  assert.match(harness.element('confirmationMessage').textContent, /Its 2 rules.*also be deleted/);
  assert.deepEqual(harness.messages, []);
  await harness.element('confirmationCancelBtn').dispatch('click');
  await flush();
  assert.equal(state.profiles.length, 2);
  await harness.element('profileList').dispatch('click', { target: harness.actionButton('delete', 'qa') });
  await harness.element('confirmationConfirmBtn').dispatch('click');
  await flush();
  assert.equal(state.profiles.length, 1);
  assert.ok(state.rules.every((rule) => rule.profileId !== 'qa'));
  assert.equal(harness.messages.at(-1).type, 'headerkit:profiles:delete');
});

test('profile activation requests missing access in the click task before reading grants or committing', async (t) => {
  const harness = await setup(t);
  const activating = activateProfile('qa');
  assert.deepEqual(harness.calls, ['request']);
  await activating;
  assert.deepEqual(harness.calls, ['request', 'read-grants', 'intent', 'refresh']);
  assert.equal(state.activation.profileId, 'qa');
  assert.equal(harness.element('activeSetupStatus').textContent, 'QA is now active.');
  assert.ok(state.grantedOrigins.has('https://staging.example.com/*'));
  harness.calls.length = 0;
  await activateProfile('qa');
  assert.deepEqual(harness.calls, []);
});

for (const failure of ['denied', 'error']) {
  test(`a ${failure} permission request still activates the profile and reports incomplete access`, async (t) => {
    const harness = await setup(t);
    chrome.permissions.request = (_details, callback) => {
      harness.calls.push('request');
      if (failure === 'error') chrome.runtime.lastError = { message: 'Permission surface closed' };
      callback(false);
      delete chrome.runtime.lastError;
    };
    await activateProfile('qa');
    assert.equal(state.activation.profileId, 'qa');
    assert.match(harness.element('activeSetupStatus').textContent, /QA is now active, but some.*need site access/);
    assert.equal(harness.element('activeSetupStatus').classList.contains('error'), true);
  });
}

for (const count of [0, 1]) {
  test(`duplicating a profile with ${count} rules keeps the matching explanation and result copy`, async (t) => {
    const harness = await setup(t);
    const stored = harness.getStored();
    stored.rules = stored.rules.filter((rule) => rule.profileId === 'qa').slice(0, count);
    state.rules = structuredClone(stored.rules);
    await harness.element('profileList').dispatch('click', { target: harness.actionButton('duplicate', 'qa') });
    if (count === 0) assert.match(harness.element('profileManagerDescription').textContent, /no rules to copy/);
    await submit(harness, 'Copy');
    assert.match(
      harness.element('profileStatus').textContent,
      count === 0 ? /Created an empty copy of QA as Copy/ : /Copied 1 rule into Copy. It remains paused and editable/
    );
  });
}

test('a profile removed while its editor is open preserves the draft and reports the stale reference', async (t) => {
  const harness = await setup(t);
  await harness.element('profileList').dispatch('click', { target: harness.actionButton('rename', 'qa') });
  state.profiles = state.profiles.filter((profile) => profile.id !== 'qa');
  await submit(harness, 'New QA');
  assert.deepEqual(harness.messages, []);
  assert.equal(harness.element('profileEditorForm').hidden, false);
  assert.equal(harness.element('profileNameInput').value, 'New QA');
  assert.equal(harness.element('profileEditorError').textContent, 'That profile no longer exists.');
});

test('failed tab activation restores usable controls, selection, and focus to the saved active profile', async (t) => {
  const harness = await setup(t);
  let release;
  chrome.runtime.sendMessage = (_message, callback) => {
    release = () => callback({ ok: false, error: 'Activation rejected' });
  };
  const qaTab = harness.tabs()[1];
  await harness.element('profileTabs').dispatch('click', { target: qaTab });
  await flush();
  assert.equal(qaTab.disabled, true);
  release();
  await flush();
  assert.equal(qaTab.disabled, false);
  assert.equal(state.activation.profileId, 'default');
  assert.equal(document.activeElement.dataset.profileTab, 'default');
  assert.equal(harness.element('activeSetupStatus').textContent, 'Activation rejected');
});

test('profile action instances keep explicit dependencies and do not require a document or Chrome globals', async () => {
  const make = () => {
    const fixture = createBackupFixture();
    const snapshot = { ...fixture, activation: createDefaultActivation(), grantedOrigins: new Set() };
    const calls = [];
    const actions = createProfileActions({
      getState: () => snapshot,
      setGrantedOrigins: (origins) => {
        snapshot.grantedOrigins = origins;
      },
      refreshState: async () => {
        calls.push('refresh');
      },
      sendIntent: async (intent) => {
        calls.push(intent);
        return { profile: { id: 'created', name: intent.name }, rules: [] };
      }
    });
    return { actions, calls };
  };
  const first = make();
  const second = make();
  assert.equal(first.actions.prepareSave({ mode: 'create' }, ' ').ok, false);
  assert.equal(first.actions.prepareDeletion('default'), null);
  assert.equal(first.actions.prepareDeletion('missing'), null);
  assert.equal(first.actions.prepareDeletion('qa').ruleCount, 2);
  const change = first.actions.prepareSave({ mode: 'create' }, ' Isolated ');
  const result = await first.actions.save(change);
  assert.equal(result.profile.id, 'created');
  assert.deepEqual(first.calls, [{ type: 'headerkit:profiles:create', name: 'Isolated' }, 'refresh']);
  assert.deepEqual(second.calls, []);
  await second.actions.remove('qa');
  assert.deepEqual(second.calls, [{ type: 'headerkit:profiles:delete', id: 'qa' }, 'refresh']);
});

test('a committed profile whose refresh fails is not reported as an unqualified UI success', async () => {
  const fixture = createBackupFixture();
  const error = new Error('Refresh failed');
  const messages = [];
  const actions = createProfileActions({
    getState: () => fixture,
    setGrantedOrigins() {},
    sendIntent: async (message) => {
      messages.push(message);
      return { profile: { id: 'created' } };
    },
    refreshState: async () => {
      throw error;
    }
  });
  const change = actions.prepareSave({ mode: 'create' }, 'Saved');
  await assert.rejects(actions.save(change), (received) => received === error);
  assert.deepEqual(messages, [{ type: 'headerkit:profiles:create', name: 'Saved' }]);
});

test('cached broad access skips permission prompts and tab keyboard navigation only moves focus', async (t) => {
  const harness = await setup(t);
  state.grantedOrigins = new Set(['https://*/*']);
  await activateProfile('qa');
  assert.deepEqual(harness.calls, ['intent', 'refresh']);
  const tabs = harness.tabs();
  let prevented = false;
  await harness.element('profileTabs').dispatch('keydown', {
    target: tabs[1],
    currentTarget: harness.element('profileTabs'),
    key: 'Home',
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true);
  assert.equal(document.activeElement, tabs[0]);
  assert.equal(state.activation.profileId, 'qa');
  assert.equal(harness.messages.length, 1);
});
