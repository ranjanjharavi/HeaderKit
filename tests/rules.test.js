import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areRulesConflicting,
  buildDynamicRule,
  filterRulesByHost,
  filterRulesByProfile,
  findActiveRuleConflict,
  getActiveRuleConflicts,
  getNextRuleId,
  groupRulesByDomain,
  getRuleOriginPattern,
  normalizeDomain,
  normalizePathPrefix,
  normalizeRules,
  validateRuleDraft
} from '../extension/shared/domain/rules.js';

const sampleRules = [
  {
    id: 1,
    domain: 'api.example.com',
    headerName: 'X-Auth',
    headerValue: 'one',
    enabled: true
  },
  {
    id: 2,
    domain: 'other.example.com',
    headerName: 'X-Debug',
    headerValue: 'two',
    enabled: false
  }
];

test('path prefixes normalize to segment prefixes and reject unsafe URL parts', () => {
  assert.equal(normalizePathPrefix('api/v1/'), '/api/v1');
  assert.equal(normalizePathPrefix('/'), '');
  assert.equal(normalizePathPrefix(''), '');
  assert.equal(normalizePathPrefix('/api?debug=1'), null);
  assert.equal(normalizePathPrefix('/api#section'), null);
  assert.equal(normalizePathPrefix('/api/../admin'), null);
  assert.equal(normalizePathPrefix('/api\\\\admin'), null);
  assert.equal(normalizePathPrefix('/api\u0001x'), null);
  assert.equal(normalizePathPrefix(`/${'a'.repeat(513)}`), null);
});

test('normalizeDomain accepts HTTPS hosts and rejects HTTP', () => {
  assert.equal(normalizeDomain('API.Example.com/path'), 'api.example.com');
  assert.equal(normalizeDomain('https://api.example.com:8443/path'), 'api.example.com');
  assert.equal(normalizeDomain('http://localhost:3000'), '');
});

test('normalizeDomain rejects unsupported protocols and empty values', () => {
  assert.equal(normalizeDomain('chrome://extensions'), '');
  assert.equal(normalizeDomain('file:///tmp/example'), '');
  assert.equal(normalizeDomain(''), '');
});

test('normalizeRules repairs identifiers and normalizes fields', () => {
  const normalized = normalizeRules([
    { ...sampleRules[0], domain: 'HTTPS://API.EXAMPLE.COM/path' },
    { ...sampleRules[1], id: 1 },
    { id: 3, domain: '', headerName: 'X-Missing', headerValue: 'value' },
    { id: 4, domain: 'example.com', headerName: 'Bad Header', headerValue: 'value' }
  ]);

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized.map((rule) => rule.id), [1, 2]);
  assert.equal(normalized[0].domain, 'api.example.com');
  assert.equal(normalized[1].enabled, false);
});

test('validateRuleDraft normalizes host and optional request scope', () => {
  const result = validateRuleDraft({
    domain: 'https://API.example.com/path',
    headerName: ' X-Test ',
    headerValue: ' value '
  }, []);

  assert.deepEqual(result, {
    ok: true,
    rule: {
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'value',
      pathPrefix: '',
      resourceType: 'all'
    }
  });

  const scoped = validateRuleDraft({
    domain: 'api.example.com',
    headerName: 'X-Test',
    headerValue: 'value',
    pathPrefix: 'api/v2/',
    resourceType: 'xmlhttprequest'
  }, []);
  assert.deepEqual(scoped.rule, {
    domain: 'api.example.com',
    headerName: 'X-Test',
    headerValue: 'value',
    pathPrefix: '/api/v2',
    resourceType: 'xmlhttprequest'
  });
});

test('validateRuleDraft rejects invalid and duplicate rules', () => {
  assert.equal(validateRuleDraft({ domain: '', headerName: '', headerValue: '' }, []).ok, false);
  assert.equal(validateRuleDraft({
    domain: 'example.com',
    headerName: 'Bad Header',
    headerValue: 'value'
  }, []).error, 'Enter a valid HTTP header name.');
  assert.equal(validateRuleDraft({
    domain: 'example.com',
    headerName: 'X-Test',
    headerValue: 'bad\nvalue'
  }, []).error, 'Header values cannot contain line breaks.');
  assert.match(validateRuleDraft({
    domain: 'example.com',
    headerName: 'X-Test',
    headerValue: 'value',
    pathPrefix: '/api?token=1'
  }, []).error, /valid path prefix/);
  assert.equal(validateRuleDraft({
    domain: 'example.com',
    headerName: 'X-Test',
    headerValue: 'value',
    resourceType: 'script'
  }, []).error, 'Choose a supported request type.');
  assert.equal(
    validateRuleDraft(sampleRules[0], sampleRules).error,
    'A rule for that header and request scope already exists for this host in this profile.'
  );
  assert.equal(validateRuleDraft({
    ...sampleRules[0],
    headerName: 'x-auth',
    headerValue: 'different',
    enabled: false
  }, sampleRules, { enabled: false }).ok, false);
  assert.equal(validateRuleDraft(sampleRules[0], sampleRules, { excludeId: 1 }).ok, true);
});

test('conflict detection finds different active values for the same header and host', () => {
  const conflictingRule = {
    id: 3,
    domain: 'api.example.com',
    headerName: 'x-auth',
    headerValue: 'different',
    enabled: true
  };
  const matchingRule = { ...sampleRules[0], id: 4 };
  const sameValueRule = { ...conflictingRule, id: 5, headerValue: 'one' };
  const pausedRule = { ...conflictingRule, id: 6, enabled: false };

  assert.equal(areRulesConflicting(sampleRules[0], conflictingRule), true);
  assert.equal(areRulesConflicting(matchingRule, conflictingRule), true);
  assert.equal(areRulesConflicting(sampleRules[0], sameValueRule), false);
  assert.equal(areRulesConflicting(sampleRules[0], pausedRule), false);
  assert.equal(findActiveRuleConflict(conflictingRule, sampleRules)?.id, 1);
  assert.deepEqual(getActiveRuleConflicts([sampleRules[0], conflictingRule]), [{
    leftRule: sampleRules[0],
    rightRule: conflictingRule
  }]);
});

test('validateRuleDraft rejects duplicate headers even for paused drafts', () => {
  const draft = {
    domain: 'api.example.com',
    headerName: 'x-auth',
    headerValue: 'different'
  };

  const activeResult = validateRuleDraft(draft, sampleRules);
  assert.equal(activeResult.ok, false);
  assert.match(activeResult.error, /already exists for this host/);
  assert.equal(validateRuleDraft(draft, sampleRules, { enabled: false }).ok, false);
});

test('rule collection helpers preserve exact-host behavior', () => {
  assert.equal(getNextRuleId(sampleRules), 3);
  assert.deepEqual(filterRulesByHost(sampleRules, 'https://api.example.com/path'), [sampleRules[0]]);
  assert.deepEqual(groupRulesByDomain(sampleRules), [
    { domain: 'api.example.com', rules: [sampleRules[0]] },
    { domain: 'other.example.com', rules: [sampleRules[1]] }
  ]);
});

test('normalizeRules assigns the default profile and repairs unknown ones', () => {
  const normalized = normalizeRules([
    sampleRules[0],
    { ...sampleRules[1], profileId: 'staging' },
    { ...sampleRules[0], id: 7, profileId: 'deleted-profile' }
  ], { profileIds: new Set(['default', 'staging']) });

  assert.deepEqual(normalized.map((rule) => rule.profileId), ['default', 'staging', 'default']);
});

test('the same header with different values is allowed across profiles', () => {
  const stagingRule = { ...sampleRules[0], profileId: 'staging' };
  const prodRule = { ...sampleRules[0], id: 9, headerValue: 'different', profileId: 'prod' };
  const activation = { masterEnabled: true, profileId: 'staging' };

  assert.equal(areRulesConflicting(stagingRule, prodRule, activation), false);
  assert.deepEqual(getActiveRuleConflicts([stagingRule, prodRule], activation), []);
  assert.equal(findActiveRuleConflict(prodRule, [stagingRule], { activation }), null);
});

test('conflicts only occur when request scopes overlap', () => {
  const base = { ...sampleRules[0], pathPrefix: '/api', resourceType: 'xmlhttprequest' };
  const nested = { ...base, id: 8, pathPrefix: '/api/v2', headerValue: 'different' };
  const otherPath = { ...base, id: 9, pathPrefix: '/admin', headerValue: 'different' };
  const similarName = { ...base, id: 10, pathPrefix: '/apix', headerValue: 'different' };
  const wholeHost = { ...base, id: 11, pathPrefix: '', headerValue: 'different' };

  assert.equal(areRulesConflicting(base, nested), true);
  assert.equal(areRulesConflicting(base, otherPath), false);
  assert.equal(areRulesConflicting(base, similarName), false);
  assert.equal(areRulesConflicting(base, wholeHost), true);
});

test('the same header can have different values in disjoint scopes', () => {
  const apiRule = { ...sampleRules[0], pathPrefix: '/api' };
  const adminRule = { ...sampleRules[0], id: 12, pathPrefix: '/admin', headerValue: 'different' };

  assert.equal(validateRuleDraft(adminRule, [apiRule]).ok, true);
  assert.equal(validateRuleDraft({ ...adminRule, pathPrefix: '/api/v2' }, [apiRule]).ok, false);
});

test('conflicts inside the active profile are still caught', () => {
  const stagingRule = { ...sampleRules[0], profileId: 'staging' };
  const clashingRule = { ...sampleRules[0], id: 9, headerValue: 'different', profileId: 'staging' };
  const activation = { masterEnabled: true, profileId: 'staging' };

  assert.equal(areRulesConflicting(stagingRule, clashingRule, activation), true);
  assert.equal(findActiveRuleConflict(clashingRule, [stagingRule], { activation })?.id, 1);
});

test('a paused master switch means nothing conflicts', () => {
  const clashingRule = { ...sampleRules[0], id: 9, headerValue: 'different' };
  const activation = { masterEnabled: false, profileId: 'default' };

  assert.deepEqual(getActiveRuleConflicts([sampleRules[0], clashingRule], activation), []);
});

test('an identical rule in another profile is not a duplicate', () => {
  const stagingRules = [{ ...sampleRules[0], profileId: 'staging' }];

  assert.equal(validateRuleDraft(sampleRules[0], stagingRules, {
    activation: { masterEnabled: true, profileId: 'prod' },
    profileId: 'prod'
  }).ok, true);

  assert.equal(validateRuleDraft(sampleRules[0], stagingRules, {
    activation: { masterEnabled: true, profileId: 'staging' },
    profileId: 'staging'
  }).error, 'A rule for that header and request scope already exists for this host in this profile.');
});

test('profile helpers filter rules', () => {
  const stagingRule = { ...sampleRules[0], profileId: 'staging' };
  const rules = [stagingRule, sampleRules[1]];

  assert.deepEqual(filterRulesByProfile(rules, 'staging'), [stagingRule]);
  assert.deepEqual(filterRulesByProfile([sampleRules[1]], 'default'), [sampleRules[1]]);
});

test('buildDynamicRule preserves host-wide defaults and applies path/type scopes', () => {
  const defaultRule = buildDynamicRule(sampleRules[0]);
  assert.deepEqual(defaultRule.condition.resourceTypes, [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
    'xmlhttprequest', 'ping', 'csp_report', 'media', 'other'
  ]);
  assert.match('https://api.example.com/path', new RegExp(defaultRule.condition.regexFilter));
  assert.doesNotMatch('http://api.example.com/path', new RegExp(defaultRule.condition.regexFilter));
  assert.doesNotMatch('https://sub.api.example.com/path', new RegExp(defaultRule.condition.regexFilter));

  const scopedRule = buildDynamicRule({
    ...sampleRules[0],
    pathPrefix: '/api/v1',
    resourceType: 'xmlhttprequest'
  });
  const scopedPattern = new RegExp(scopedRule.condition.regexFilter);
  assert.deepEqual(scopedRule.condition.resourceTypes, ['xmlhttprequest']);
  assert.match('https://api.example.com/api/v1', scopedPattern);
  assert.match('https://api.example.com/api/v1/users?active=1', scopedPattern);
  assert.doesNotMatch('https://api.example.com/api/v10/users', scopedPattern);
  assert.doesNotMatch('https://api.example.com/admin', scopedPattern);
  assert.equal(getRuleOriginPattern(sampleRules[0]), 'https://api.example.com/*');
});
