import { storageLocalGet, storageLocalSet } from '../runtime/chrome-api.js';

const PRIVACY_CONSENT_KEY = 'privacyConsentVersion';
const PRIVACY_CONSENT_VERSION = 2;

export async function requirePrivacyConsent() {
  const gate = document.getElementById('privacyGate');
  const app = document.getElementById('appShell');
  const acceptButton = document.getElementById('privacyConsentBtn');
  const status = document.getElementById('privacyConsentStatus');
  const stored = await storageLocalGet({ [PRIVACY_CONSENT_KEY]: 0 });

  if (Number(stored[PRIVACY_CONSENT_KEY]) >= PRIVACY_CONSENT_VERSION) {
    showApp(gate, app);
    return;
  }

  gate.hidden = false;
  app.hidden = true;
  await new Promise((resolve) => {
    acceptButton.addEventListener('click', async () => {
      acceptButton.disabled = true;
      status.textContent = '';

      try {
        await storageLocalSet({ [PRIVACY_CONSENT_KEY]: PRIVACY_CONSENT_VERSION });
        showApp(gate, app);
        resolve();
      } catch (error) {
        console.error('Could not save privacy consent.', error);
        status.textContent = 'Chrome could not save your choice. Please try again.';
        acceptButton.disabled = false;
      }
    });
  });
}

function showApp(gate, app) {
  gate.hidden = true;
  app.hidden = false;
}
