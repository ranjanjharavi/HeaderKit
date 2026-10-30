import { confirmDestructiveAction } from '../../shared/ui/confirmation-dialog.js';
import { showStatus } from '../../shared/ui/ui.js';
import { state } from '../state.js';
import { createSiteAccessActions } from './actions.js';
import * as view from './view.js';

export { renderSiteAccessOverview } from './view.js';

let actions;
let renderRules;

export function bindSiteAccessEvents({ onRefreshState, onRenderRules }) {
  actions = createSiteAccessActions({
    getState: () => state,
    setGrantedOrigins: (origins) => {
      state.grantedOrigins = origins;
    },
    refreshState: onRefreshState
  });
  renderRules = onRenderRules;
  document.getElementById('siteAccessBtn').addEventListener('click', openSiteAccessDialog);
  document.getElementById('closeSiteAccessBtn').addEventListener('click', view.closeSiteAccessDialog);
  document.getElementById('doneSiteAccessBtn').addEventListener('click', view.closeSiteAccessDialog);
  document.getElementById('siteAccessDialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      view.closeSiteAccessDialog();
    }
  });
  document.getElementById('siteAccessList').addEventListener('click', handleSiteAccessListClick);
  document.getElementById('siteAccessSearch').addEventListener('input', view.filterSiteAccessGrants);
  chrome.permissions.onAdded.addListener(refreshAfterPermissionChange);
  chrome.permissions.onRemoved.addListener(refreshAfterPermissionChange);
}

async function openSiteAccessDialog() {
  const retrying = view.openSiteAccessDialog();
  view.renderLoading();
  view.clearSiteAccessStatus();
  try {
    await actions.refresh();
    view.renderSiteAccessOverview();
    if (retrying && view.isSiteAccessDialogOpen()) {
      view.focusLoadedSiteAccess();
    }
  } catch (error) {
    console.error('Could not load granted site access.', error);
    view.renderLoadError();
    if (retrying && view.isSiteAccessDialogOpen()) {
      view.focusSiteAccessRetry();
    }
  }
}

function handleSiteAccessListClick(event) {
  const button = event.target.closest('[data-site-access-action]');
  if (!button) {
    return;
  }
  if (button.dataset.siteAccessAction === 'retry') {
    void openSiteAccessDialog();
  } else if (button.dataset.siteAccessAction === 'revoke') {
    void revokeOrigin(button.dataset.origin, button);
  }
}

async function revokeOrigin(origin, button) {
  const revocation = actions.prepareRevocation(origin);
  if (!revocation) {
    return;
  }
  const confirmed = await confirmDestructiveAction(view.getRevokeConfirmation(revocation));
  if (!confirmed) {
    return;
  }
  view.beginRevocation(origin, button);
  try {
    await actions.revoke(origin);
    renderRules();
    view.showRevocationSuccess(origin);
  } catch (error) {
    console.error('Could not revoke site access.', error);
    showStatus('siteAccessStatus', error.message || 'Could not revoke this site access grant.', 'error');
  } finally {
    view.finishRevocation(origin);
  }
}

function refreshAfterPermissionChange() {
  actions
    .refresh()
    .then(view.renderSiteAccessOverview)
    .catch((error) => {
      console.error('Could not refresh site access grants.', error);
      if (view.isSiteAccessDialogOpen()) {
        view.renderLoadError();
      }
    });
}
