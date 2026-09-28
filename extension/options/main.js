import { requirePrivacyConsent } from '../shared/ui/privacy.js';
import {
  bindRuleEvents,
  initializeRules,
  refreshFromStorage,
  renderRules
} from './rules/controller.js';
import { bindProfileEvents } from './profiles/controller.js';
import { bindSiteAccessEvents } from './site-access/controller.js';
import { showStatus } from '../shared/ui/ui.js';

document.addEventListener('DOMContentLoaded', () => {
  start().catch((error) => {
    console.error('Could not start the rule manager.', error);
    const status = document.getElementById('privacyConsentStatus');
    status.textContent = 'ReqKit could not start. Reload this page and try again.';
  });
});

async function start() {
  await requirePrivacyConsent();
  bindRuleEvents();
  bindProfileEvents({ onChanged: refreshFromStorage });
  bindSiteAccessEvents({ onRefreshState: refreshFromStorage, onRenderRules: renderRules });

  await initializeRules({ editRuleId: readEditRuleId() }).catch((error) => {
    console.error('Could not load header rules.', error);
    showStatus('headerStatus', 'Could not load header rules.', 'error');
  });

  focusRequestedSection();
}

/**
 * The popup hands a rule over as `?edit=<id>` so its edit button opens the
 * manager already focused on that rule.
 */
function readEditRuleId() {
  const requestedId = Number(new URLSearchParams(globalThis.location.search).get('edit'));
  return Number.isInteger(requestedId) && requestedId > 0 ? requestedId : null;
}

function focusRequestedSection() {
  if (globalThis.location.hash !== '#active-setup') {
    return;
  }

  globalThis.setTimeout(() => {
    const section = document.getElementById('active-setup');
    section.scrollIntoView({ block: 'start' });
    const focusTarget = document.querySelector('#durationPills [data-duration][aria-checked="true"]:not(:disabled)')
      || document.querySelector('#profileTabs [aria-selected="true"]');
    focusTarget?.focus({ preventScroll: true });
  }, 0);
}
