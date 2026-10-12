import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, readStyles } from '../../helpers/source.js';

const popupMarkup = readSource('extension/popup/index.html');
const popupStyles = readStyles('extension/shared/styles/index.css') + readStyles('extension/popup/popup.css');
const popupRulesSource = readSource('extension/popup/headers/controller.js') + readSource('extension/popup/headers/composer.js') + readSource('extension/popup/headers/view.js') + readSource('extension/popup/headers/actions.js') + readSource('extension/popup/activation/controller.js');

test('popup keeps profile context in the header and scopes rules with tabs', () => {
  assert.match(popupMarkup, /<main id="headers-panel" class="popup-shell">/);
  assert.doesNotMatch(popupMarkup, /class="product-kicker"/);
  assert.match(popupMarkup, /id="activeProfileName"/);
  assert.match(popupMarkup, /id="activeUntilLabel"/);
  assert.match(popupMarkup, /Accept to open ReqKit\. Existing rules and site access are unchanged/);
  assert.match(popupMarkup, /id="changeActiveSetupBtn"/);
  assert.match(popupMarkup, /id="ruleScopeTabs"[^>]*role="tablist"/);
  assert.match(popupMarkup, /id="currentSiteTab"[^>]*role="tab"[^>]*aria-controls="ruleListContainer"/);
  assert.match(popupMarkup, /id="allRulesTab"[^>]*role="tab"[^>]*aria-controls="ruleListContainer"/);
  assert.match(popupMarkup, /id="ruleListContainer"[^>]*role="tabpanel"[^>]*aria-labelledby="currentSiteTab"[^>]*tabindex="0"/);
  assert.match(popupMarkup, /id="headerStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(popupMarkup, /id="headerComposerToggle"[\s\S]*?Add rule for this site/);
  assert.doesNotMatch(popupMarkup, /id="profileSelect"/);
  assert.doesNotMatch(popupMarkup, /id="durationSelect"/);
  assert.doesNotMatch(popupMarkup, /header-composer-heading|headerComposerTitle|headerComposerProfile/);
  assert.match(popupMarkup, /id="siteAccessPreflight"[\s\S]*?Chrome will ask you to grant ReqKit site access to this exact HTTPS host/);
  assert.match(popupMarkup, /id="requestScopeDetails"[\s\S]*?id="pathPrefix"[\s\S]*?id="resourceType"/);
  assert.match(popupMarkup, /id="confirmationDialog"[^>]*aria-labelledby="confirmationTitle"/);
});

test('popup keeps optional scope secondary and aligns its paired controls', () => {
  const form = popupMarkup.match(/<form id="headerComposerForm"[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);

  const landmarks = [
    'for="domain"',
    'for="headerName"',
    'for="headerValue"',
    'id="requestScopeDetails"',
    'id="siteAccessPreflight"',
    'id="addHeaderBtn"'
  ];
  const positions = landmarks.map((landmark) => form.indexOf(landmark));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));

  assert.match(form, /id="resourceType"[\s\S]*?class="helper-text request-scope-hint"/);
  assert.match(popupStyles, /\.request-scope-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(popupStyles, /\.request-scope-fields \.field > input,[\s\S]*?height:\s*var\(--control-height\)/);
});

test('empty popup state relies on the footer add action', () => {
  assert.match(popupRulesSource, /container\.classList\.toggle\('is-empty', !visibleRules\.length\)/);
  assert.doesNotMatch(popupRulesSource, /empty-state-action[^\n]*data-rule-action="open-composer"/);
});
