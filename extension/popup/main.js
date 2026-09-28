import { getCurrentTab } from '../shared/runtime/chrome-api.js';
import { bindHeaderEvents, initializeHeaders } from './headers/controller.js';
import { requirePrivacyConsent } from '../shared/ui/privacy.js';
import { showStatus } from '../shared/ui/ui.js';

document.addEventListener('DOMContentLoaded', () => {
  start().catch((error) => {
    console.error('Could not start the popup.', error);
    const status = document.getElementById('privacyConsentStatus');
    status.textContent = 'ReqKit could not start. Close the popup and try again.';
  });
});

async function start() {
  await requirePrivacyConsent();
  bindHeaderEvents();

  await initialize().catch((error) => {
    console.error('Could not initialize the popup.', error);
    showStatus('headerStatus', 'Could not load header rules.', 'error');
  });
}

async function initialize() {
  let activeTab = null;
  try {
    activeTab = await getCurrentTab();
  } catch (error) {
    console.error('Could not read the current tab.', error);
  }

  await initializeHeaders(activeTab);
}
