import {
  DEFAULT_PROFILE_ID,
  PROFILE_STORAGE_KEY,
  cloneRulesIntoProfile,
  countRulesInProfile,
  createProfile,
  getProfileName,
  removeRulesFromProfile,
  validateProfileDraft
} from '../../shared/domain/profiles.js';
import {
  removeOriginPermission,
  requestOriginPermissions,
  storageLocalSet
} from '../../shared/runtime/chrome-api.js';
import {
  createDefaultActivation,
  getTargetProfileId,
  setActiveProfile
} from '../../shared/domain/activation.js';
import { setActivationState } from '../../shared/runtime/activation-api.js';
import { getMissingProfileOrigins } from '../../shared/domain/site-access.js';
import { getNextRuleId, getRuleOriginPattern } from '../../shared/domain/rules.js';
import { commitRules } from '../../shared/runtime/rule-api.js';
import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { state } from '../state.js';
import { readGrantedOrigins } from '../../shared/runtime/site-access-api.js';
import { escapeHtml, showStatus } from '../../shared/ui/ui.js';

let refreshAll = async () => {};
let profileEditor = null;

export function bindProfileEvents({ onChanged }) {
  refreshAll = onChanged;

  document.getElementById('newProfileBtn').addEventListener('click', () => openProfileEditor('create'));
  document.getElementById('profileList').addEventListener('click', handleProfileListClick);
  document.getElementById('profileTabs').addEventListener('click', handleProfileTabClick);
  document.getElementById('profileTabs').addEventListener('keydown', handleProfileTabKeydown);
  document.getElementById('profileEditorForm').addEventListener('submit', handleProfileEditorSubmit);
  document.getElementById('profileNameInput').addEventListener('input', clearProfileEditorError);
  document.getElementById('cancelProfileEditorBtn').addEventListener('click', () => showProfileList());
  document.getElementById('manageProfilesBtn').addEventListener('click', openProfileManager);
  document.getElementById('closeProfileManagerBtn').addEventListener('click', closeProfileManager);
  document.getElementById('doneProfileManagerBtn').addEventListener('click', closeProfileManager);
  document.getElementById('profileManagerDialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closeProfileManager();
    }
  });
  document.getElementById('profileManagerDialog').addEventListener('close', () => {
    showProfileList({ restoreFocus: false });
  });
}

function handleProfileTabClick(event) {
  const tab = event.target.closest('[data-profile-tab]');
  if (!tab || tab.getAttribute('aria-selected') === 'true') {
    return;
  }

  tab.disabled = true;
  activateProfile(tab.dataset.profileTab).finally(() => {
    tab.disabled = false;
    renderProfiles();
    const selectedTab = [...document.querySelectorAll('#profileTabs [data-profile-tab]')]
      .find((profileTab) => profileTab.getAttribute('aria-selected') === 'true');
    selectedTab?.focus();
  });
}

function handleProfileTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }

  const tabs = [...event.currentTarget.querySelectorAll('[data-profile-tab]')];
  const currentIndex = tabs.indexOf(event.target.closest('[data-profile-tab]'));
  if (currentIndex < 0 || !tabs.length) {
    return;
  }

  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex].focus();
}

function openProfileManager() {
  showProfileList({ restoreFocus: false });
  document.getElementById('profileManagerDialog').showModal();
}

function closeProfileManager() {
  const dialog = document.getElementById('profileManagerDialog');
  if (dialog.open) {
    dialog.close();
  }
}

function handleProfileListClick(event) {
  const button = event.target.closest('[data-profile-action]');
  if (!button) {
    return;
  }

  const { profileAction, id } = button.dataset;
  if (profileAction === 'rename' || profileAction === 'duplicate') {
    openProfileEditor(profileAction, id, button);
    return;
  }
  if (profileAction === 'delete') {
    deleteProfile(id);
  }
}

export function renderProfiles() {
  const { profiles, rules } = state;
  const activeProfileId = getTargetProfileId(getActivation());
  const selectedTabIndex = profiles.findIndex((profile) => profile.id === activeProfileId);
  const tabs = document.getElementById('profileTabs');
  const list = document.getElementById('profileList');

  tabs.innerHTML = profiles.map((profile, index) => {
    const isActive = profile.id === activeProfileId;
    const ruleCount = countRulesInProfile(rules, profile.id);

    return `
      <button id="profileTab-${index}" class="profile-tab" type="button" role="tab" aria-selected="${String(isActive)}" aria-controls="profilePanel" tabindex="${isActive ? '0' : '-1'}" data-profile-tab="${escapeHtml(profile.id)}">
        <span>${escapeHtml(profile.name)}</span>
        <span class="profile-tab-count">${ruleCount}</span>
      </button>
    `;
  }).join('');

  const profilePanel = document.getElementById('profilePanel');
  if (selectedTabIndex >= 0) {
    profilePanel.setAttribute('aria-labelledby', `profileTab-${selectedTabIndex}`);
  } else {
    profilePanel.removeAttribute('aria-labelledby');
  }

  document.getElementById('activeProfileRunLabel').textContent = `${getProfileName(profiles, activeProfileId)} runs until`;

  list.innerHTML = profiles.map((profile) => {
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
          ${profile.id === DEFAULT_PROFILE_ID
    ? ''
    : `<button class="profile-action-btn danger" type="button" data-profile-action="delete" data-id="${escapeHtml(profile.id)}">Delete</button>`}
        </div>
      </article>
    `;
  }).join('');
}

function getActivation() {
  return state.activation || createDefaultActivation();
}

function openProfileEditor(mode, id = null, returnFocus = null) {
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

function showProfileList({ restoreFocus = true, focusAction = null, profileId = null } = {}) {
  const previousEditor = profileEditor;
  profileEditor = null;
  document.getElementById('profileManagerTitle').textContent = 'Manage profiles';
  document.getElementById('profileManagerDescription').textContent = 'Organize rule sets without changing what is currently applied.';
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
    const action = [...document.querySelectorAll('#profileList [data-profile-action]')]
      .find((button) => button.dataset.profileAction === focusAction && button.dataset.id === profileId);
    (action || document.getElementById('newProfileBtn')).focus();
    return;
  }

  if (previousEditor?.returnFocus?.isConnected) {
    previousEditor.returnFocus.focus();
  } else {
    document.getElementById('newProfileBtn').focus();
  }
}

function clearProfileEditorError() {
  const input = document.getElementById('profileNameInput');
  const error = document.getElementById('profileEditorError');
  if (!input || !error) {
    return;
  }

  error.textContent = '';
  error.hidden = true;
  input.removeAttribute('aria-invalid');
}

function showProfileEditorError(message) {
  const input = document.getElementById('profileNameInput');
  const error = document.getElementById('profileEditorError');
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

async function handleProfileEditorSubmit(event) {
  event.preventDefault();
  if (!profileEditor) {
    return;
  }

  const { mode, id } = profileEditor;
  const name = document.getElementById('profileNameInput').value;
  const validation = validateProfileDraft(
    { name },
    state.profiles,
    { excludeId: mode === 'rename' ? id : null }
  );
  if (!validation.ok) {
    showProfileEditorError(validation.error);
    return;
  }

  const submitButton = document.getElementById('saveProfileEditorBtn');
  submitButton.disabled = true;
  const originalLabel = submitButton.textContent;
  submitButton.textContent = 'Saving…';

  try {
    if (mode === 'create') {
      const newProfile = createProfile(validation.profile.name);
      await saveProfiles([...state.profiles, newProfile]);
      showProfileList({ focusAction: 'rename', profileId: newProfile.id });
      showStatus('profileStatus', `Created ${validation.profile.name}.`, 'success');
      return;
    }

    if (mode === 'rename') {
      const profile = state.profiles.find((candidate) => candidate.id === id);
      if (!profile) {
        throw new Error('That profile no longer exists.');
      }
      if (profile.name === validation.profile.name) {
        showProfileList({ focusAction: 'rename', profileId: id });
        return;
      }

      await saveProfiles(state.profiles.map((candidate) => (
        candidate.id === id ? { ...candidate, name: validation.profile.name } : candidate
      )));
      showProfileList({ focusAction: 'rename', profileId: id });
      showStatus('profileStatus', `Renamed to ${validation.profile.name}.`, 'success');
      return;
    }

    const source = state.profiles.find((candidate) => candidate.id === id);
    if (!source) {
      throw new Error('That profile no longer exists.');
    }
    const newProfile = createProfile(validation.profile.name);
    const clonedRules = cloneRulesIntoProfile(
      state.rules,
      id,
      newProfile.id,
      getNextRuleId(state.rules)
    ).map((rule) => ({ ...rule, enabled: false }));

    state.syncPaused = true;
    try {
      await storeProfiles([...state.profiles, newProfile]);
      try {
        await commitRules([...state.rules, ...clonedRules]);
      } catch (error) {
        await storeProfiles(state.profiles);
        throw error;
      }
      await refreshAll();
    } finally {
      state.syncPaused = false;
    }

    showProfileList({ focusAction: 'duplicate', profileId: id });
    const copyMessage = clonedRules.length === 0
      ? `Created an empty copy of ${source.name} as ${newProfile.name}.`
      : clonedRules.length === 1
        ? `Copied 1 rule into ${newProfile.name}. It remains paused and editable.`
        : `Copied ${clonedRules.length} rules into ${newProfile.name}. They remain paused and editable.`;
    showStatus('profileStatus', copyMessage, 'success');
  } catch (error) {
    console.error(error);
    showProfileEditorError(error.message || 'Could not save that profile.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function deleteProfile(id) {
  const profile = state.profiles.find((candidate) => candidate.id === id);
  if (!profile || id === DEFAULT_PROFILE_ID) {
    return;
  }

  const ruleCount = countRulesInProfile(state.rules, id);
  const consequence = ruleCount
    ? `Its ${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'} and related data will also be deleted.`
    : 'It has no rules.';

  const confirmed = await confirmDestructiveAction({
    title: `Delete ${profile.name}?`,
    message: consequence,
    confirmLabel: 'Delete profile'
  });
  if (!confirmed) {
    return;
  }

  const activation = getActivation();
  const referencesDeletedProfile = activation.profileId === id || activation.lastProfileId === id;
  const deletedRules = state.rules.filter((rule) => rule.profileId === id);
  const remainingRules = removeRulesFromProfile(state.rules, id);

  try {
    state.syncPaused = true;
    await commitRules(remainingRules);

    if (referencesDeletedProfile) {
      await setActivationState(setActiveProfile(activation, DEFAULT_PROFILE_ID));
    }

    await storeProfiles(state.profiles.filter((candidate) => candidate.id !== id));
    await releaseDeletedProfilePermissions(deletedRules, remainingRules);
    await refreshAll();
    showStatus('profileStatus', `Deleted ${profile.name}. ${consequence}`, 'success');
  } catch (error) {
    console.error(error);
    showStatus('profileStatus', error.message || 'Could not delete that profile.', 'error');
  } finally {
    state.syncPaused = false;
  }
}

async function releaseDeletedProfilePermissions(deletedRules, remainingRules) {
  const remainingDomains = new Set(remainingRules.map((rule) => rule.domain));
  const origins = new Set(
    deletedRules
      .filter((rule) => !remainingDomains.has(rule.domain))
      .map(getRuleOriginPattern)
  );

  await Promise.all([...origins].map(async (origin) => {
    try {
      await removeOriginPermission(origin);
    } catch (error) {
      console.error(`Could not release site access for ${origin}.`, error);
    }
  }));
}

export async function activateProfile(id) {
  const activation = getActivation();
  if (id === activation.profileId) {
    return;
  }

  // Read from the cached grant list so permissions.request stays inside the
  // click's task — an await here would lose the user gesture Chrome requires.
  const missingOrigins = getMissingProfileOrigins(state.rules, id, state.grantedOrigins);

  let granted = true;
  if (missingOrigins.length) {
    try {
      granted = await requestOriginPermissions(missingOrigins);
    } catch (error) {
      console.error('Could not request site access for that profile.', error);
      granted = false;
    }
    state.grantedOrigins = await readGrantedOrigins();
  }

  try {
    state.syncPaused = true;
    state.activation = await setActivationState(setActiveProfile(activation, id));
    await refreshAll();

    const name = getProfileName(state.profiles, id);
    showStatus(
      'activeSetupStatus',
      granted
        ? `${name} is now active.`
        : `${name} is now active, but some of its rules still need site access.`,
      granted ? 'success' : 'error'
    );
  } catch (error) {
    console.error(error);
    showStatus('activeSetupStatus', error.message || 'Could not activate that profile.', 'error');
  } finally {
    state.syncPaused = false;
  }
}

async function saveProfiles(profiles) {
  state.syncPaused = true;
  try {
    await storeProfiles(profiles);
    await refreshAll();
  } finally {
    state.syncPaused = false;
  }
}

function storeProfiles(profiles) {
  return storageLocalSet({ [PROFILE_STORAGE_KEY]: profiles });
}
