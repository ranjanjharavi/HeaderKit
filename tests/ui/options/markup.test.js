import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, readStyles } from '../../helpers/source.js';

const optionsMarkup = readSource('extension/options/index.html');
const optionsStyles = readStyles('extension/options/options.css');
const popupRulesSource = readSource('extension/popup/headers/controller.js') + readSource('extension/popup/headers/composer.js') + readSource('extension/popup/headers/view.js') + readSource('extension/popup/headers/actions.js') + readSource('extension/popup/activation/controller.js');
const optionsRulesSource = readSource('extension/options/rules/controller.js') + readSource('extension/options/rules/composer.js') + readSource('extension/options/rules/view.js') + readSource('extension/options/rules/actions.js') + readSource('extension/options/activation/controller.js');
const optionsProfilesSource = readSource('extension/options/profiles/controller.js');
const siteAccessControllerSource = readSource('extension/options/site-access/controller.js');
const sharedRuleRenderSource = readSource('extension/shared/ui/rule-render.js');

test('rule manager separates active setup, rules, and profile administration', () => {
  assert.match(optionsMarkup, /id="active-setup"/);
  assert.match(optionsMarkup, /You must accept this notice to use ReqKit/);
  assert.match(optionsMarkup, /id="profileTabs"[^>]*role="tablist"/);
  assert.match(optionsMarkup, /id="profilePanel"[^>]*role="tabpanel"[^>]*aria-labelledby="profileTab-0"/);
  assert.doesNotMatch(optionsMarkup, /activeProfileSelect|profileFilterSelect/);
  assert.match(optionsMarkup, /id="durationPills"[^>]*role="radiogroup"/);
  assert.equal((optionsMarkup.match(/class="duration-pill"/g) || []).length, 4);
  assert.doesNotMatch(optionsMarkup, /id="durationSelect"/);
  assert.match(optionsMarkup, /id="headerComposerToggle"[^>]*>\s*<svg[\s\S]*?New rule/);
  assert.match(optionsMarkup, /class="header-fields-row"[\s\S]*?for="headerName"[\s\S]*?for="headerValue"/);
  assert.match(optionsMarkup, /class="helper-text disclosure-text composer-disclosure"/);
  assert.match(optionsMarkup, /id="siteAccessPreflight"[\s\S]*?No other sites are included in the request/);
  assert.match(optionsMarkup, /id="requestScopeDetails"[\s\S]*?id="pathPrefix"[\s\S]*?id="resourceType"/);
  assert.match(sharedRuleRenderSource, /editPathPrefix/);
  assert.match(sharedRuleRenderSource, /editResourceType/);
  assert.match(optionsMarkup, /<dialog id="profileManagerDialog"/);
  assert.match(optionsMarkup, /id="manageProfilesBtn"/);
  assert.match(optionsMarkup, /<form id="profileEditorForm"[^>]*novalidate[^>]*hidden>/);
  assert.match(optionsMarkup, /id="profileNameInput"[^>]*maxlength="40"[^>]*required/);
  assert.match(optionsMarkup, /id="profileEditorError"[^>]*role="alert"/);
  assert.match(optionsMarkup, /id="cancelProfileEditorBtn"/);
  assert.doesNotMatch(optionsProfilesSource, /globalThis\.prompt/);
  assert.match(optionsProfilesSource, /validateProfileDraft/);
  assert.match(optionsProfilesSource, /Copied rules start paused and remain editable/);
  assert.match(popupRulesSource, /Your rules stay saved and editable/);
  assert.match(optionsRulesSource, /Your rules stay saved and editable/);
  assert.doesNotMatch(optionsMarkup, /class="product-kicker"|class="workspace-kicker"/);
  assert.match(optionsMarkup, /id="confirmationDialog"[^>]*aria-labelledby="confirmationTitle"/);
});

test('site access overview audits grants and revokes without deleting rules', () => {
  assert.match(optionsMarkup, /id="siteAccessBtn"[^>]*aria-controls="siteAccessDialog"/);
  assert.match(optionsMarkup, /<dialog id="siteAccessDialog"[^>]*aria-labelledby="siteAccessTitle"/);
  assert.match(optionsMarkup, /id="siteAccessList"[^>]*aria-busy="false"/);
  assert.match(optionsMarkup, /class="site-access-search"[^>]*hidden[\s\S]*?id="siteAccessSearch" type="search"[\s\S]*?aria-controls="siteAccessList"/);
  assert.match(siteAccessControllerSource, /filterOriginGrants\(origins, search\.value\)/);
  assert.match(siteAccessControllerSource, /getRulesForOriginGrant/);
  assert.match(siteAccessControllerSource, /removeOriginPermission\(origin\)/);
  assert.match(siteAccessControllerSource, /confirmDestructiveAction/);
  assert.match(siteAccessControllerSource, /Saved rules were kept/);
  assert.match(optionsMarkup, /Review ReqKit's site access grants/);
  assert.match(siteAccessControllerSource, /Broad site access/);
  assert.match(siteAccessControllerSource, /Can cover rules for any HTTPS host/);
  assert.match(siteAccessControllerSource, /Host-specific site access/);
  assert.match(siteAccessControllerSource, /\.site-access-rules\[open\]/);
  assert.match(siteAccessControllerSource, /expandedOrigins\.has\(origin\) \? ' open' : ''/);
  assert.match(siteAccessControllerSource, /<summary data-site-access-action="rules" data-origin="\$\{escapeHtml\(origin\)\}">\$\{rules\.length} saved/);
  assert.match(siteAccessControllerSource, /list\.scrollTop = scrollTop/);
  assert.doesNotMatch(siteAccessControllerSource, /No site permissions|Loading site permissions|Broad grant|Host grant/);
  assert.match(optionsStyles, /\.site-access-row\.is-broad/);
  assert.match(optionsStyles, /\.site-access-row\[hidden\]/);
  assert.match(optionsStyles, /\.site-access-search input\s*\{\s*min-height: 44px/);
  assert.match(optionsStyles, /\.site-access-revoke-btn\s*\{\s*min-height: 44px/);
  assert.match(optionsStyles, /\.site-access-dialog-actions \.primary-btn,[\s\S]*?min-height: 44px/);
  assert.match(optionsStyles, /\.site-access-row-heading\s*\{\s*align-items: flex-start;\s*flex-direction: column/);
  assert.match(siteAccessControllerSource, /Number\(isBroadOrigin\(right\)\)/);
  assert.doesNotMatch(siteAccessControllerSource, /headerValue/);
});

test('rule-manager privacy links stay in the same extension tab', () => {
  const privacyLinks = optionsMarkup.match(/<a\b[^>]*href="\.\.\/privacy\/index\.html"[^>]*>/g) || [];

  assert.equal(privacyLinks.length, 2);
  privacyLinks.forEach((link) => {
    assert.doesNotMatch(link, /\btarget=/);
  });
});
