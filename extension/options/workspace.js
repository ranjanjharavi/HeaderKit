import { RULE_STORAGE_KEY } from '../shared/domain/rules.js';
import { onStorageChanged, storageLocalGet } from '../shared/runtime/chrome-api.js';
import {
  ACTIVATION_STORAGE_KEY,
  createDefaultActivation,
  normalizeActivation
} from '../shared/domain/activation.js';
import {
  PROFILE_STORAGE_KEY,
  createDefaultProfiles,
  getProfileIds,
  normalizeProfiles
} from '../shared/domain/profiles.js';
import { renderProfiles } from './profiles/controller.js';
import { getStoredRules } from '../shared/runtime/rule-api.js';
import { state } from './state.js';
import { renderSiteAccessOverview } from './site-access/controller.js';
import { renderMasterSwitch, renderDurationField } from './activation/controller.js';
import { renderRules } from './rules/controller.js';
import { readGrantedOrigins } from '../shared/runtime/site-access-api.js';

export async function refreshFromStorage() {
  await loadActivation();
  state.rules = await getStoredRules();
  renderWorkspace();
}

async function loadActivation() {
  try {
    const stored = await storageLocalGet([PROFILE_STORAGE_KEY, ACTIVATION_STORAGE_KEY]);
    const profiles = normalizeProfiles(stored[PROFILE_STORAGE_KEY]);
    state.profiles = profiles;
    state.activation = normalizeActivation(stored[ACTIVATION_STORAGE_KEY], {
      profileIds: getProfileIds(profiles)
    });
  } catch (error) {
    console.error('Could not read the activation state.', error);
    state.profiles = createDefaultProfiles();
    state.activation = createDefaultActivation();
  }

  state.grantedOrigins = await readGrantedOrigins();
}

export function renderWorkspace() {
  renderMasterSwitch();
  renderProfiles();
  renderDurationField();
  renderRules();
  renderSiteAccessOverview();
}

export function bindWorkspaceEvents() {
  onStorageChanged((changes) => {
    const touchesRules = RULE_STORAGE_KEY in changes
      || ACTIVATION_STORAGE_KEY in changes
      || PROFILE_STORAGE_KEY in changes;

    if (touchesRules && !state.syncPaused) {
      refreshFromStorage().catch((error) => {
        console.error('Could not refresh header rules.', error);
      });
    }
  });
}
