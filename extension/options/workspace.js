import { RULE_STORAGE_KEY } from '../shared/domain/rules.js';
import { onStorageChanged } from '../shared/runtime/chrome-api.js';
import { ACTIVATION_STORAGE_KEY } from '../shared/domain/activation.js';
import { PROFILE_STORAGE_KEY } from '../shared/domain/profiles.js';
import { renderProfiles } from './profiles/controller.js';
import { createStateRefresh } from '../shared/runtime/state-api.js';
import { state } from './state.js';
import { renderSiteAccessOverview } from './site-access/controller.js';
import { renderMasterSwitch, renderDurationField } from './activation/controller.js';
import { renderRules } from './rules/controller.js';
export const { refresh: refreshFromStorage, schedule: scheduleRefresh } = createStateRefresh((snapshot) => {
  Object.assign(state, snapshot);
  if (state.editingId !== null && !state.rules.some((rule) => rule.id === state.editingId)) {
    state.editingId = null;
  }
  renderWorkspace();
});

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

    if (touchesRules) {
      scheduleRefresh();
    }
  });
}
