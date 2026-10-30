import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDynamicRule } from '../../extension/background/rule-compiler.js';
import { areRulesConflicting, validateRuleDraft } from '../../extension/shared/domain/rules.js';

const sampleRule = {
  id: 1,
  domain: 'api.example.com',
  headerName: 'X-Auth',
  headerValue: 'one',
  enabled: true
};

const allResourceTypes = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'other'
];

function pattern(rule = sampleRule) {
  const { condition } = buildDynamicRule(rule);
  return new RegExp(condition.regexFilter, condition.isUrlFilterCaseSensitive ? '' : 'i');
}

test('compilation produces the complete Chrome header action and host-wide condition', () => {
  assert.deepEqual(buildDynamicRule(sampleRule), {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'X-Auth', operation: 'set', value: 'one' }]
    },
    condition: {
      resourceTypes: allResourceTypes,
      isUrlFilterCaseSensitive: true,
      regexFilter: String.raw`^https:\/\/api\.example\.com(?::\d+)?(?:[/?#]|$)`
    }
  });
});

test('host-wide compilation accepts HTTPS ports and URL boundaries without broadening the host', () => {
  const expression = pattern();
  for (const url of [
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/path',
    'https://api.example.com?debug=1',
    'https://api.example.com#section',
    'https://api.example.com:443/path',
    'https://api.example.com:8443/path'
  ]) {
    assert.match(url, expression, url);
  }
  for (const url of [
    'http://api.example.com/path',
    'wss://api.example.com/path',
    'https://sub.api.example.com/path',
    'https://api.example.com.evil/path',
    'https://apiXexample.com/path',
    'https://api.example.com@evil.test/path',
    'https://user@api.example.com/path',
    'https://api.example.com:/path',
    'https://api.example.com:port/path',
    'https://api.example.com:8443.evil/path',
    'https://evil.test/?next=https://api.example.com/path'
  ]) {
    assert.doesNotMatch(url, expression, url);
  }
});

test('scoped compilation preserves fetch/XHR scope and path-segment boundaries', () => {
  const rule = { ...sampleRule, pathPrefix: '/api/v1', resourceType: 'xmlhttprequest' };
  assert.deepEqual(buildDynamicRule(rule).condition.resourceTypes, ['xmlhttprequest']);
  const expression = pattern(rule);
  for (const url of [
    'https://api.example.com/api/v1',
    'https://api.example.com/api/v1/',
    'https://api.example.com/api/v1/users?active=1',
    'https://api.example.com/api/v1?active=1',
    'https://api.example.com/api/v1#section',
    'https://api.example.com:8443/api/v1/users'
  ]) {
    assert.match(url, expression, url);
  }
  for (const url of [
    'https://api.example.com/api/v10/users',
    'https://api.example.com/api/v1x',
    'https://api.example.com/admin',
    'https://api.example.com/API/v1',
    'https://sub.api.example.com/api/v1',
    'http://api.example.com/api/v1'
  ]) {
    assert.doesNotMatch(url, expression, url);
  }
});

test('compilation preserves root defaults and normalizes optional segment prefixes', () => {
  for (const pathPrefix of [undefined, null, '', '/', '///']) {
    assert.deepEqual(buildDynamicRule({ ...sampleRule, pathPrefix }), buildDynamicRule(sampleRule));
  }
  for (const pathPrefix of ['api/v1/', '/api/v1', '///api/v1///']) {
    assert.deepEqual(
      buildDynamicRule({ ...sampleRule, pathPrefix }),
      buildDynamicRule({ ...sampleRule, pathPrefix: '/api/v1' })
    );
  }
});

test('Unicode and encoded paths compile against serialized URLs without losing segment boundaries', () => {
  for (const pathPrefix of ['/caf\u00e9', '/caf%C3%A9', '/\u65e5\u672c\u8a9e', '/\u{1f600}', '/a%2Fb', '/a%25b']) {
    const expression = pattern({ ...sampleRule, pathPrefix });
    assert.match(new URL(`https://api.example.com${pathPrefix}/users`).href, expression, pathPrefix);
    assert.doesNotMatch(new URL(`https://api.example.com${pathPrefix}x`).href, expression, pathPrefix);
  }
  assert.equal(
    buildDynamicRule({ ...sampleRule, pathPrefix: '/caf\u00e9' }).condition.regexFilter,
    String.raw`^https:\/\/api\.example\.com(?::\d+)?/caf%C3%A9(?:/|[?#]|$)`
  );
});

test('DNR path case sensitivity agrees with domain conflict detection', () => {
  const upperRule = { ...sampleRule, pathPrefix: '/API' };
  const lowerRule = { ...sampleRule, id: 3, pathPrefix: '/api', headerValue: 'different' };
  assert.equal(areRulesConflicting(upperRule, lowerRule), false);
  assert.equal(validateRuleDraft(lowerRule, [upperRule]).ok, true);
  assert.equal(buildDynamicRule(upperRule).condition.isUrlFilterCaseSensitive, true);
  assert.match('https://api.example.com/API/users', pattern(upperRule));
  assert.doesNotMatch('https://api.example.com/api/users', pattern(upperRule));
});

test('path regex metacharacters remain literal rather than broadening the condition', () => {
  const pathPrefix = '/v1.0+/(beta)/$^|/items[0]';
  const expression = pattern({ ...sampleRule, pathPrefix });
  assert.match(new URL(`https://api.example.com${pathPrefix}/child`).href, expression);
  for (const path of [
    '/v1x0+/(beta)/$^|/items[0]',
    '/v1.0/(beta)/$^|/items[0]',
    '/v1.0+/beta/$^|/items[0]',
    '/v1.0+/(beta)/middle/items[0]',
    '/v1.0+/(beta)/$^|/items0'
  ]) {
    assert.doesNotMatch(new URL(`https://api.example.com${path}`).href, expression, path);
  }
});

for (const domain of ['localhost', '127.0.0.1', '[::1]', '[2001:db8::1]', 'xn--bcher-kva.example']) {
  test(`compilation preserves exact HTTPS host and port handling for ${domain}`, () => {
    const expression = pattern({ ...sampleRule, domain });
    assert.match(`https://${domain}/path`, expression);
    assert.match(`https://${domain}:8443/path`, expression);
    assert.doesNotMatch(`http://${domain}/path`, expression);
    assert.doesNotMatch(`https://${domain}.evil/path`, expression);
    assert.doesNotMatch(`https://other.test/?next=https://${domain}/path`, expression);
    if (domain === '127.0.0.1') assert.doesNotMatch('https://127x0x0x1/path', expression);
    if (domain === '[::1]') assert.doesNotMatch('https://::1/path', expression);
  });
}

test('resource-type normalization retains supported scopes and the existing compiler fallback', () => {
  for (const resourceType of [undefined, null, '', 'all', ' ALL ', 'script']) {
    assert.deepEqual(buildDynamicRule({ ...sampleRule, resourceType }).condition.resourceTypes, allResourceTypes);
  }
  for (const resourceType of ['xmlhttprequest', ' XMLHTTPREQUEST ']) {
    assert.deepEqual(buildDynamicRule({ ...sampleRule, resourceType }).condition.resourceTypes, ['xmlhttprequest']);
  }
  // Invalid write intents are still rejected by the domain, not accepted by this fallback.
  assert.equal(validateRuleDraft({ ...sampleRule, resourceType: 'script' }, []).field, 'resourceType');
});

test('compilation leaves frozen business rules unchanged and does not decide activation or permission eligibility', () => {
  const rule = Object.freeze({
    ...sampleRule,
    enabled: false,
    profileId: 'parked',
    pathPrefix: '/api',
    resourceType: 'xmlhttprequest'
  });
  const before = structuredClone(rule);
  const compiled = buildDynamicRule(rule);
  assert.deepEqual(rule, before);
  assert.deepEqual(compiled.action.requestHeaders, [
    { header: rule.headerName, operation: 'set', value: rule.headerValue }
  ]);
  assert.equal(compiled.id, rule.id);
  assert.equal('enabled' in compiled, false);
  assert.equal('profileId' in compiled, false);
  assert.deepEqual(buildDynamicRule(rule), compiled);
});
