import { DEFAULT_PROFILE_ID, countRulesInProfile, getProfileName } from '../../shared/domain/profiles.js';
import { getTargetProfileId } from '../../shared/domain/activation.js';
import { escapeHtml, showStatus } from '../../shared/ui/ui.js';
import { state, getActivation } from '../state.js';

let profileEditor = null;

export function renderProfiles() {
  const { profiles, rules } = state;
  const activeProfileId = getTargetProfileId(getActivation());
  const selectedTabIndex = profiles.findIndex((profile) => profile.id === activeProfileId);
  const tabs = document.getElementById('profileTabs');
  const list = document.getElementById('profileList');

  tabs.innerHTML = profiles
    .map((profile, index) => {
      const isActive = profile.id === activeProfileId;
      const ruleCount = countRulesInProfile(rules, profile.id);
      return `
      <button id="profileTab-${index}" class="profile-tab" type="button" role="tab" aria-selected="${String(isActive)}" aria-controls="profilePanel" tabindex="${isActive ? '0' : '-1'}" data-profile-tab="${escapeHtml(profile.id)}">
        <span>${escapeHtml(profile.name)}</span>
        <span class="profile-tab-count">${ruleCount}</span>
      </button>
    `;
    })
    .join('');

  const profilePanel = document.getElementById('profilePanel');
  if (selectedTabIndex >= 0) {
    profilePanel.setAttribute('aria-labelledby', `profileTab-${selectedTabIndex}`);
  } else {
    profilePanel.removeAttribute('aria-labelledby');
  }
  document.getElementById('activeProfileRunLabel').textContent =
    `${getProfileName(profiles, activeProfileId)} runs until`;
  list.innerHTML = profiles
    .map((profile) => {
      const ruleCount = countRulesInProfile(rules, profile.id);
      const isActive = profile.id === activeProfileId;
      return `
      <article class="profile-row${isActive ? ' is-active' : ''}">
        <div class="profile-row-main">
          <span class="profile-row-name">${escapeHtml(profile.name)}</span>
          ${isActive ? '<span class="profile-row-badge">Active</span>' : ''}
          <span class="profile-row-count">${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}</span>
        </div>
        <div class="profile-row-actions">
          <button class="profile-action-btn" type="button" data-profile-action="rename" data-id="${escapeHtml(profile.id)}">Rename</button>
          <button class="profile-action-btn" type="button" data-profile-action="duplicate" data-id="${escapeHtml(profile.id)}">Duplicate</button>
          ${profile.id === DEFAULT_PROFILE_ID ? '' : `<button class="profile-action-btn danger" type="button" data-profile-action="delete" data-id="${escapeHtml(profile.id)}">Delete</button>`}
        </div>
      </article>
    `;
    })
    .join('');
}

export function focusSelectedProfileTab() {
  const selectedTab = [...document.querySelectorAll('#profileTabs [data-profile-tab]')].find(
    (tab) => tab.getAttribute('aria-selected') === 'true'
  );
  selectedTab?.focus();
}

export function openProfileManager() {
  showProfileList({ restoreFocus: false });
  document.getElementById('profileManagerDialog').showModal();
}

export function closeProfileManager() {
  const dialog = document.getElementById('profileManagerDialog');
  if (dialog.open) {
    dialog.close();
  }
}

export function openProfileEditor(mode, id = null, returnFocus = null) {
  const source = id ? state.profiles.find((profile) => profile.id === id) : null;
  if (id && !source) {
    return;
  }

  profileEditor = { mode, id, returnFocus };
  const input = document.getElementById('profileNameInput');
  const title = document.getElementById('profileManagerTitle');
  const description = document.getElementById('profileManagerDescription');
  const submitButton = document.getElementById('saveProfileEditorBtn');
  const suggestedName = mode === 'duplicate' ? `${source.name} copy`.slice(0, 40) : '';
  if (mode === 'create') {
    title.textContent = 'New profile';
    description.textContent = 'Create an empty profile. It will not become active automatically.';
    submitButton.textContent = 'Create profile';
    input.value = '';
  } else if (mode === 'rename') {
    title.textContent = 'Rename profile';
    description.textContent = `Choose a new name for ${source.name}.`;
    submitButton.textContent = 'Save name';
    input.value = source.name;
  } else {
    title.textContent = `Duplicate ${source.name}`;
    description.textContent = countRulesInProfile(state.rules, source.id)
      ? 'Copied rules start paused and remain editable, so the copy will not change your active requests.'
      : 'This profile has no rules to copy, so the new profile will be empty.';
    submitButton.textContent = 'Create copy';
    input.value = suggestedName;
  }
  clearProfileEditorError();
  document.getElementById('profileList').hidden = true;
  document.getElementById('profileStatus').hidden = true;
  document.getElementById('profileManagerActions').hidden = true;
  document.getElementById('profileEditorForm').hidden = false;
  input.focus();
  input.select();
}

export function getProfileEditor() {
  return profileEditor ? { mode: profileEditor.mode, id: profileEditor.id } : null;
}

export function readProfileName() {
  return document.getElementById('profileNameInput').value;
}

export function beginProfileSave() {
  const button = document.getElementById('saveProfileEditorBtn');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  return () => {
    button.disabled = false;
    button.textContent = originalLabel;
  };
}

export function showProfileList({ restoreFocus = true, focusAction = null, profileId = null } = {}) {
  const previousEditor = profileEditor;
  profileEditor = null;
  document.getElementById('profileManagerTitle').textContent = 'Manage profiles';
  document.getElementById('profileManagerDescription').textContent =
    'Organize rule sets without changing what is currently applied.';
  document.getElementById('profileEditorForm').reset();
  document.getElementById('profileEditorForm').hidden = true;
  document.getElementById('profileList').hidden = false;
  document.getElementById('profileStatus').hidden = false;
  document.getElementById('profileManagerActions').hidden = false;
  clearProfileEditorError();
  if (!restoreFocus) {
    return;
  }
  if (focusAction && profileId) {
    const action = [...document.querySelectorAll('#profileList [data-profile-action]')].find(
      (button) => button.dataset.profileAction === focusAction && button.dataset.id === profileId
    );
    (action || document.getElementById('newProfileBtn')).focus();
    return;
  }
  if (previousEditor?.returnFocus?.isConnected) {
    previousEditor.returnFocus.focus();
  } else {
    document.getElementById('newProfileBtn').focus();
  }
}

export function clearProfileEditorError() {
  const input = document.getElementById('profileNameInput');
  const error = document.getElementById('profileEditorError');
  if (!input || !error) {
    return;
  }
  error.textContent = '';
  error.hidden = true;
  input.removeAttribute('aria-invalid');
}

export function showProfileEditorError(message) {
  const input = document.getElementById('profileNameInput');
  const error = document.getElementById('profileEditorError');
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

export function showProfileSaveResult(result) {
  if (result.mode === 'create') {
    showProfileList({ focusAction: 'rename', profileId: result.profile.id });
    showStatus('profileStatus', `Created ${result.name}.`, 'success');
  } else if (result.mode === 'rename') {
    showProfileList({ focusAction: 'rename', profileId: result.profile.id });
    if (!result.unchanged) {
      showStatus('profileStatus', `Renamed to ${result.name}.`, 'success');
    }
  } else {
    showProfileList({ focusAction: 'duplicate', profileId: result.sourceId });
    let message = `Created an empty copy of ${result.sourceName} as ${result.profile.name}.`;
    if (result.copiedCount === 1) {
      message = `Copied 1 rule into ${result.profile.name}. It remains paused and editable.`;
    } else if (result.copiedCount > 1) {
      message = `Copied ${result.copiedCount} rules into ${result.profile.name}. They remain paused and editable.`;
    }
    showStatus('profileStatus', message, 'success');
  }
}

function getDeleteConsequence(ruleCount) {
  const ruleLabel = ruleCount === 1 ? 'rule' : 'rules';
  return ruleCount ? `Its ${ruleCount} ${ruleLabel} and related data will also be deleted.` : 'It has no rules.';
}

export function getProfileDeleteConfirmation({ profile, ruleCount }) {
  return { title: `Delete ${profile.name}?`, message: getDeleteConsequence(ruleCount), confirmLabel: 'Delete profile' };
}

export function showProfileDeleted({ profile, ruleCount }) {
  showStatus('profileStatus', `Deleted ${profile.name}. ${getDeleteConsequence(ruleCount)}`, 'success');
}

export function showProfileActivated({ name, granted }) {
  showStatus(
    'activeSetupStatus',
    granted ? `${name} is now active.` : `${name} is now active, but some of its rules still need site access.`,
    granted ? 'success' : 'error'
  );
}
