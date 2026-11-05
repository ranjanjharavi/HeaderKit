import { storageLocalGet, storageLocalSet } from '../runtime/chrome-api.js';
import { clearStatus, keepControlFocus, showStatus } from './ui.js';

const PRIVACY_CONSENT_KEY = 'privacyConsentVersion';
const PRIVACY_CONSENT_VERSION = 2;

export async function requirePrivacyConsent() {
  const gate = document.getElementById('privacyGate');
  const app = document.getElementById('appShell');
  const acceptButton = document.getElementById('privacyConsentBtn');
  const stored = await storageLocalGet({ [PRIVACY_CONSENT_KEY]: 0 });

  if (Number(stored[PRIVACY_CONSENT_KEY]) >= PRIVACY_CONSENT_VERSION) {
    showApp(gate, app);
    return;
  }

  gate.hidden = false;
  app.hidden = true;
  await new Promise((resolve) => {
    acceptButton.addEventListener('click', async () => {
      const restoreFocus = keepControlFocus();
      acceptButton.disabled = true;
      clearStatus('privacyConsentStatus');

      try {
        await storageLocalSet({ [PRIVACY_CONSENT_KEY]: PRIVACY_CONSENT_VERSION });
        showApp(gate, app);
        resolve();
      } catch (error) {
        console.error('Could not save privacy consent.', error);
        showStatus('privacyConsentStatus', 'Chrome could not save your choice. Please try again.', 'error');
        acceptButton.disabled = false;
        restoreFocus();
      }
    });
  });
}

/**
 * Startup can fail before or after consent, so report it on whichever screen is showing.
 */
export function showStartupError(message) {
  const onConsentScreen = !document.getElementById('privacyGate').hidden;
  showStatus(onConsentScreen ? 'privacyConsentStatus' : 'headerStatus', message, 'error');
}

function showApp(gate, app) {
  gate.hidden = true;
  app.hidden = false;
}
