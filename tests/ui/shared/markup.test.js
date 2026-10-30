import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, readStyles } from '../../helpers/source.js';

const popupStyles = readStyles('extension/shared/styles/index.css') + readStyles('extension/popup/popup.css');
const optionsStyles = readStyles('extension/options/options.css');
const popupRulesSource =
  readSource('extension/popup/headers/controller.js') +
  readSource('extension/popup/headers/composer.js') +
  readSource('extension/popup/headers/view.js') +
  readSource('extension/popup/headers/actions.js') +
  readSource('extension/popup/activation/controller.js');
const optionsRulesSource =
  readSource('extension/options/rules/controller.js') +
  readSource('extension/options/rules/composer.js') +
  readSource('extension/options/rules/view.js') +
  readSource('extension/options/rules/actions.js') +
  readSource('extension/options/activation/controller.js');
const sharedRuleRenderSource = readSource('extension/shared/ui/rule-render.js');
const optionsStateSource = readSource('extension/options/state.js');
const sharedUiSource = readSource('extension/shared/ui/ui.js');

test('popup and manager use readable supporting text and contrast tokens', () => {
  const styles = `${popupStyles}\n${optionsStyles}`;
  assert.match(popupStyles, /--type-body:\s*14px/);
  assert.match(popupStyles, /--type-label:\s*13px/);
  assert.match(popupStyles, /--type-support:\s*12px/);
  assert.match(popupStyles, /input::placeholder\s*\{[^}]*color:\s*#64748b/s);
  assert.match(optionsStyles, /--manager-subtle:\s*#5f6b7a/);
  assert.doesNotMatch(styles, /font-size:\s*(?:9(?:\.5)?|10(?:\.5)?|11(?:\.5)?)px/);
  assert.doesNotMatch(styles, /font-size:\s*0\.\d+em/);
});

test('keyboard focus and dynamic tab panels expose consistent accessible state', () => {
  assert.match(
    popupStyles,
    /button:focus-visible,[\s\S]*?summary:focus-visible,[\s\S]*?outline:\s*2px solid var\(--primary\)/
  );
  assert.doesNotMatch(`${popupStyles}\n${optionsStyles}`, /\.focus-visible\s*\{[^}]*outline:\s*(?:0|none)/s);
  // Popup and profile tab/panel attributes are checked behaviorally in their feature tests.
});

test('obsolete profile filter and clipboard code are removed', () => {
  assert.doesNotMatch(optionsStateSource, /profileFilter/);
  assert.doesNotMatch(optionsRulesSource, /renderProfileFilter|resolveFilterValue/);
  assert.doesNotMatch(optionsStyles, /profile-filter/);
  assert.doesNotMatch(popupStyles, /profile-select/);
  assert.doesNotMatch(sharedUiSource, /copyToClipboard/);
});

test('rule editor keeps header inputs together and the disclosure on its own row', () => {
  assert.match(sharedRuleRenderSource, /rule-edit-field-name[\s\S]*?rule-edit-field-value/);
  assert.match(sharedRuleRenderSource, /rule-edit-disclosure/);
});

test('rule destructive actions use the HeaderKit confirmation dialog', () => {
  [popupRulesSource, optionsRulesSource].forEach((source) => {
    assert.match(source, /confirmDestructiveAction/);
    assert.doesNotMatch(source, /globalThis\.confirm/);
  });
});

test('text inputs share the ten pixel padding token', () => {
  assert.match(popupStyles, /--input-padding:\s*10px/);
  assert.match(popupStyles, /input\s*\{[\s\S]*?padding:\s*var\(--input-padding\)/);
  assert.doesNotMatch(optionsStyles, /rules-composer input/);
});
