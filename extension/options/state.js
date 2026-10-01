import { createDefaultActivation } from '../shared/domain/activation.js';

export const state = {
  rules: [],
  profiles: [],
  activation: null,
  grantedOrigins: null,
  editingId: null,
  composerOpen: false,
  collapsedDomains: new Set(),
  revealedRuleIds: new Set(),
  searchQuery: '',
  syncPaused: false
};

export function getActivation() {
  return state.activation || createDefaultActivation();
}
