import { getRuleOriginPattern } from '../domain/rules.js';

/**
 * Shared composer state for the exact-site explanation shown before Chrome's
 * own permission surface. Keeping the state in the DOM means changing any
 * field invalidates the prior review automatically.
 */
export function createSiteAccessPreflight({
  formId = 'headerComposerForm',
  preflightId = 'siteAccessPreflight',
  hostnameId = 'siteAccessPreflightHost',
  submitButtonId = 'addHeaderBtn',
  getDefaultSubmitLabel = () => 'Add rule'
} = {}) {
  const form = document.getElementById(formId);
  const preflight = document.getElementById(preflightId);
  const hostname = document.getElementById(hostnameId);
  const submitButton = document.getElementById(submitButtonId);

  const hide = () => {
    preflight.hidden = true;
    preflight.dataset.origin = '';
    submitButton.textContent = getDefaultSubmitLabel();
  };

  form.addEventListener('input', hide);

  return {
    hide,
    show(rule) {
      const origin = getRuleOriginPattern(rule);
      hostname.textContent = rule.domain;
      preflight.dataset.origin = origin;
      preflight.hidden = false;
      submitButton.textContent = 'Continue to Chrome';
      const composer = submitButton.closest('.header-composer');
      if (composer) {
        const revealActions = () => {
          composer.scrollTop = composer.scrollHeight;
        };
        revealActions();
        globalThis.requestAnimationFrame(revealActions);
      } else {
        submitButton.scrollIntoView({ block: 'nearest' });
      }
    },
    isReadyFor(rule) {
      return !preflight.hidden && preflight.dataset.origin === getRuleOriginPattern(rule);
    },
    syncSubmitLabel(defaultLabel) {
      submitButton.textContent = preflight.hidden ? defaultLabel || getDefaultSubmitLabel() : 'Continue to Chrome';
    }
  };
}
