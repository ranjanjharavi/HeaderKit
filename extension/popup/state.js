import { filterRulesByProfile } from '../shared/domain/rules.js';
import { createDefaultActivation, getTargetProfileId } from '../shared/domain/activation.js';

export const state = {
  headers: {
    rules: [],
    profiles: [],
    activation: null,
    grantedOrigins: null,
    composerOpen: false,
    editingId: null,
    scope: 'site',
    collapsedDomains: new Set(),
    currentHostname: '',
    revealedRuleIds: new Set(),
    syncPaused: false
  }
};

export function getActivation() {
  return state.headers.activation || createDefaultActivation();
}

/**
 * The popup only ever shows the profile in play. Rules parked in another
 * profile are not applied here, so listing them would misrepresent the site.
 */
export function getScopedRules() {
  return filterRulesByProfile(state.headers.rules, getTargetProfileId(getActivation()));
}
