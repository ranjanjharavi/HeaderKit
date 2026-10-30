import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { getNextTabIndex, showStatus } from '../../shared/ui/ui.js';
import { state } from '../state.js';
import { createProfileActions } from './actions.js';
import * as view from './view.js';

export { renderProfiles } from './view.js';

let actions;

export function bindProfileEvents({ onChanged }) {
  actions = createProfileActions({
    getState: () => state,
    setGrantedOrigins: (origins) => {
      state.grantedOrigins = origins;
    },
    refreshState: onChanged
  });
  document.getElementById('newProfileBtn').addEventListener('click', () => view.openProfileEditor('create'));
  document.getElementById('profileList').addEventListener('click', handleProfileListClick);
  document.getElementById('profileTabs').addEventListener('click', handleProfileTabClick);
  document.getElementById('profileTabs').addEventListener('keydown', handleProfileTabKeydown);
  document.getElementById('profileEditorForm').addEventListener('submit', handleProfileEditorSubmit);
  document.getElementById('profileNameInput').addEventListener('input', view.clearProfileEditorError);
  document.getElementById('cancelProfileEditorBtn').addEventListener('click', () => view.showProfileList());
  document.getElementById('manageProfilesBtn').addEventListener('click', view.openProfileManager);
  document.getElementById('closeProfileManagerBtn').addEventListener('click', view.closeProfileManager);
  document.getElementById('doneProfileManagerBtn').addEventListener('click', view.closeProfileManager);
  document.getElementById('profileManagerDialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      view.closeProfileManager();
    }
  });
  document.getElementById('profileManagerDialog').addEventListener('close', () => {
    view.showProfileList({ restoreFocus: false });
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
    view.renderProfiles();
    view.focusSelectedProfileTab();
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
  tabs[getNextTabIndex(event.key, currentIndex, tabs.length)].focus();
}

function handleProfileListClick(event) {
  const button = event.target.closest('[data-profile-action]');
  if (!button) {
    return;
  }
  const { profileAction, id } = button.dataset;
  if (profileAction === 'rename' || profileAction === 'duplicate') {
    view.openProfileEditor(profileAction, id, button);
  } else if (profileAction === 'delete') {
    void deleteProfile(id);
  }
}

async function handleProfileEditorSubmit(event) {
  event.preventDefault();
  const editor = view.getProfileEditor();
  if (!editor) {
    return;
  }
  const change = actions.prepareSave(editor, view.readProfileName());
  if (!change.ok) {
    view.showProfileEditorError(change.error);
    return;
  }
  const finishSaving = view.beginProfileSave();
  try {
    view.showProfileSaveResult(await actions.save(change));
  } catch (error) {
    console.error(error);
    view.showProfileEditorError(error.message || 'Could not save that profile.');
  } finally {
    finishSaving();
  }
}

async function deleteProfile(id) {
  const deletion = actions.prepareDeletion(id);
  if (!deletion) {
    return;
  }
  const confirmed = await confirmDestructiveAction(view.getProfileDeleteConfirmation(deletion));
  if (!confirmed) {
    return;
  }
  try {
    await actions.remove(id);
    view.showProfileDeleted(deletion);
  } catch (error) {
    console.error(error);
    showStatus('profileStatus', error.message || 'Could not delete that profile.', 'error');
  }
}

export async function activateProfile(id) {
  try {
    const result = await actions.activate(id);
    if (result) {
      view.showProfileActivated(result);
    }
  } catch (error) {
    console.error(error);
    showStatus('activeSetupStatus', error.message || 'Could not activate that profile.', 'error');
  }
}
