import { state } from './state.js';
import { getPopupRuleViewModel } from './view-model.js';
import {
  renderMasterSwitch as renderMasterSwitchView,
  renderActivationSummary as renderActivationSummaryView
} from './activation/controller.js';
import { configureComposer as configureComposerView } from './headers/composer.js';
import {
  renderCurrentSiteControls as renderCurrentSiteControlsView,
  renderRules as renderRuleView
} from './headers/view.js';

/** Explicitly coordinate the header, controls, composer, and list in reading order. */
export function createPopupWorkspace({
  getState,
  setScope,
  renderMasterSwitch,
  renderActivationSummary,
  renderCurrentSiteControls,
  configureComposer,
  renderRules
}) {
  return function renderWorkspace() {
    const snapshot = getState();
    const model = getPopupRuleViewModel(snapshot);
    if (model.scope !== snapshot.scope) {
      setScope(model.scope);
    }
    renderMasterSwitch();
    renderActivationSummary();
    renderCurrentSiteControls(model);
    configureComposer();
    renderRules(model);
  };
}

export const renderWorkspace = createPopupWorkspace({
  getState: () => state.headers,
  setScope: (scope) => {
    state.headers.scope = scope;
  },
  renderMasterSwitch: renderMasterSwitchView,
  renderActivationSummary: renderActivationSummaryView,
  renderCurrentSiteControls: renderCurrentSiteControlsView,
  configureComposer: configureComposerView,
  renderRules: renderRuleView
});
