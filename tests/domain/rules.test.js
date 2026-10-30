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
  getDisplayPathPrefix,
  groupRulesByDomain,
  getRuleOriginPattern,
  normalizeDomain,
  normalizePathPrefix,
  normalizeRules,
  parseHostInput,
  validateRuleDraft
} from '../../extension/shared/domain/rules.js';

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
  assert.equal(normalizePathPrefix(`/api${'/'.repeat(500)}`), '/api');
  assert.equal(normalizePathPrefix('/'.repeat(512)), '');
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

test('host inputs accept only exact DNS or IP hosts with an optional HTTPS prefix', () => {
  const accepted = [
    [' https://API.Example.com/ ', 'api.example.com'],
    ['localhost', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['https://[::1]/', '[::1]'],
    ['[2001:db8::1]', '[2001:db8::1]'],
    ['https://b\u00fccher.example/', 'xn--bcher-kva.example']
  ];
  for (const [input, host] of accepted) {
    assert.deepEqual(parseHostInput(input), { host }, input);
    assert.equal(validateRuleDraft({ ...sampleRules[0], domain: input }, []).rule.domain, host);
  }
});

test('host inputs reject scope broadening and malformed hosts with field errors', () => {
  const rejected = [
    ['*.example.com', /Wildcards/],
    ['https://%2a.example.com/', /valid HTTPS host/],
    ['http://api.example.com', /Only HTTPS/],
    ['api.example.com/v1', /Path prefix/],
    ['api.example.com/.', /Path prefix/],
    ['api.example.com//', /Path prefix/],
    ['api.example.com:8443', /without a port/],
    ['https://api.example.com:443/', /without a port/],
    ['[::1]:443', /without a port/],
    ['https://user:pass@api.example.com', /without credentials/],
    ['api.example.com?x=1', /without a query/],
    ['api.example.com#part', /without a fragment/],
    ['https:///api.example.com', /Path prefix/],
    ['https://api.example.com\\path', /valid HTTPS host/],
    ['api\n.example.com', /valid HTTPS host/],
    ['bad_host.example', /valid HTTPS host/],
    ['-bad.example', /valid HTTPS host/],
    ['bad-.example', /valid HTTPS host/],
    ['bad..example', /valid HTTPS host/],
    [`${'a'.repeat(64)}.example`, /valid HTTPS host/],
    [Array(5).fill('a'.repeat(63)).join('.'), /valid HTTPS host/],
    ['127.1', /valid HTTPS host/],
    ['0x7f000001', /valid HTTPS host/]
  ];
  for (const [input, error] of rejected) {
    const result = validateRuleDraft({ ...sampleRules[0], domain: input }, []);
    assert.equal(result.ok, false, input);
    assert.equal(result.field, 'domain', input);
    assert.match(result.error, error, input);
    assert.deepEqual(normalizeRules([{ ...sampleRules[0], domain: input }]), [], input);
  }
});

test('normalizeRules repairs identifiers and normalizes fields', () => {
  const normalized = normalizeRules([
    { ...sampleRules[0], domain: 'HTTPS://API.EXAMPLE.COM/' },
    { ...sampleRules[1], id: 1 },
    { id: 3, domain: '', headerName: 'X-Missing', headerValue: 'value' },
    { id: 4, domain: 'example.com', headerName: 'Bad Header', headerValue: 'value' }
  ]);

  assert.equal(normalized.length, 2);
  assert.deepEqual(
    normalized.map((rule) => rule.id),
    [1, 2]
  );
  assert.equal(normalized[0].domain, 'api.example.com');
  assert.equal(normalized[1].enabled, false);
});

test('normalizeRules reserves valid IDs before repairing invalid and duplicate entries', () => {
  const rules = [
    { ...sampleRules[0], id: null },
    { ...sampleRules[0], id: 1 },
    { ...sampleRules[0], id: 1 },
    { ...sampleRules[0], id: 9 },
    { ...sampleRules[0], id: -2 },
    { ...sampleRules[0], id: '3' }
  ];
  const normalized = normalizeRules(rules);
  assert.deepEqual(
    normalized.map((rule) => rule.id),
    [10, 1, 11, 9, 12, 3]
  );
  assert.deepEqual(normalizeRules(normalized), normalized);
  assert.deepEqual(
    rules.map((rule) => rule.id),
    [null, 1, 1, 9, -2, '3']
  );
});

test('Unicode paths canonicalize for matching, identity and safe display round trips', () => {
  const pathPrefix = '/caf\u00e9';
  const canonical = '/caf%C3%A9';
  assert.equal(normalizePathPrefix(pathPrefix), canonical);
  assert.equal(normalizePathPrefix(canonical), canonical);
  assert.equal(getDisplayPathPrefix(canonical), pathPrefix);
  for (const encoded of ['/a%2Fb', '/a%25b', '/bad%FF']) {
    assert.equal(normalizePathPrefix(getDisplayPathPrefix(encoded)), encoded);
  }
  for (const path of ['/api/%2e%2e/admin', '/api/.%2E/admin', '/api/%2e/admin']) {
    assert.equal(normalizePathPrefix(path), null);
  }
  const rule = { ...sampleRules[0], pathPrefix };
  const expression = new RegExp(buildDynamicRule(rule).condition.regexFilter);
  assert.equal(expression.test(new URL('https://api.example.com/caf\u00e9/users').href), true);
  assert.equal(expression.test('https://api.example.com/caf%C3%A9x'), false);
  assert.equal(validateRuleDraft({ ...rule, pathPrefix: canonical }, [rule]).ok, false);
  assert.equal(normalizeRules([rule])[0].pathPrefix, canonical);
});

test('validateRuleDraft normalizes host and optional request scope', () => {
  const result = validateRuleDraft(
    {
      domain: 'https://API.example.com/',
      headerName: ' X-Test ',
      headerValue: ' value '
    },
    []
  );

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

  const scoped = validateRuleDraft(
    {
      domain: 'api.example.com',
      headerName: 'X-Test',
      headerValue: 'value',
      pathPrefix: 'api/v2/',
      resourceType: 'xmlhttprequest'
    },
    []
  );
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
  assert.equal(
    validateRuleDraft(
      {
        domain: 'example.com',
        headerName: 'Bad Header',
        headerValue: 'value'
      },
      []
    ).error,
    'Enter a valid HTTP header name.'
  );
  assert.equal(
    validateRuleDraft(
      {
        domain: 'example.com',
        headerName: 'X-Test',
        headerValue: 'bad\nvalue'
      },
      []
    ).error,
    'Header values cannot contain control characters other than tabs.'
  );
  assert.match(
    validateRuleDraft(
      {
        domain: 'example.com',
        headerName: 'X-Test',
        headerValue: 'value',
        pathPrefix: '/api?token=1'
      },
      []
    ).error,
    /valid path prefix/
  );
  assert.equal(
    validateRuleDraft(
      {
        domain: 'example.com',
        headerName: 'X-Test',
        headerValue: 'value',
        resourceType: 'script'
      },
      []
    ).error,
    'Choose a supported request type.'
  );
  assert.equal(
    validateRuleDraft(sampleRules[0], sampleRules).error,
    'A rule for that header and request scope already exists for this host in this profile.'
  );
  assert.equal(
    validateRuleDraft(
      {
        ...sampleRules[0],
        headerName: 'x-auth',
        headerValue: 'different',
        enabled: false
      },
      sampleRules,
      { enabled: false }
    ).ok,
    false
  );
  assert.equal(validateRuleDraft(sampleRules[0], sampleRules, { excludeId: 1 }).ok, true);
});

test('raw header values reject C0 controls and DEL before trimming on save and load', () => {
  for (const codePoint of [...Array(32).keys(), 0x7f]) {
    if (codePoint === 9) {
      continue;
    }
    const control = String.fromCodePoint(codePoint);
    for (const headerValue of [`${control}value`, `va${control}lue`, `value${control}`]) {
      const rule = { ...sampleRules[0], headerValue };
      const result = validateRuleDraft(rule, []);
      assert.equal(result.ok, false, `control ${codePoint}`);
      assert.equal(result.field, 'headerValue');
      assert.match(result.error, /control characters/);
      assert.deepEqual(normalizeRules([rule]), []);
    }
  }
});

test('header values retain horizontal tabs and Unicode with normal outer whitespace trimming', () => {
  const rule = { ...sampleRules[0], headerValue: ' \talpha\tb\u00e9ta\t ' };
  assert.equal(validateRuleDraft(rule, []).rule.headerValue, 'alpha\tb\u00e9ta');
  assert.equal(normalizeRules([rule])[0].headerValue, 'alpha\tb\u00e9ta');
  assert.deepEqual(normalizeRules([{ ...rule, headerValue: ' \t ' }]), []);
});

test('conflict scans exclude non-live rules before comparing pairs', () => {
  let checks = 0;
  const parkedRules = Array.from({ length: 40 }, () => ({
    ...sampleRules[0],
    profileId: 'other',
    get enabled() {
      checks++;
      return true;
    }
  }));
  const liveRules = [sampleRules[0], { ...sampleRules[0], id: 3, headerValue: 'different' }];
  const conflicts = getActiveRuleConflicts([...parkedRules, ...liveRules]);
  assert.deepEqual(conflicts, [{ leftRule: liveRules[0], rightRule: liveRules[1] }]);
  assert.equal(checks, parkedRules.length);
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
  assert.deepEqual(getActiveRuleConflicts([sampleRules[0], conflictingRule]), [
    {
      leftRule: sampleRules[0],
      rightRule: conflictingRule
    }
  ]);
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
  const normalized = normalizeRules(
    [
      sampleRules[0],
      { ...sampleRules[1], profileId: 'staging' },
      { ...sampleRules[0], id: 7, profileId: 'deleted-profile' }
    ],
    { profileIds: new Set(['default', 'staging']) }
  );

  assert.deepEqual(
    normalized.map((rule) => rule.profileId),
    ['default', 'staging', 'default']
  );
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

  assert.equal(
    validateRuleDraft(sampleRules[0], stagingRules, {
      activation: { masterEnabled: true, profileId: 'prod' },
      profileId: 'prod'
    }).ok,
    true
  );

  assert.equal(
    validateRuleDraft(sampleRules[0], stagingRules, {
      activation: { masterEnabled: true, profileId: 'staging' },
      profileId: 'staging'
    }).error,
    'A rule for that header and request scope already exists for this host in this profile.'
  );
});

test('profile helpers filter rules', () => {
  const stagingRule = { ...sampleRules[0], profileId: 'staging' };
  const rules = [stagingRule, sampleRules[1]];

  assert.deepEqual(filterRulesByProfile(rules, 'staging'), [stagingRule]);
  assert.deepEqual(filterRulesByProfile([sampleRules[1]], 'default'), [sampleRules[1]]);
});

test('buildDynamicRule preserves host-wide defaults and applies path/type scopes', () => {
  const defaultRule = buildDynamicRule(sampleRules[0]);
  assert.equal(defaultRule.condition.isUrlFilterCaseSensitive, true);
  assert.deepEqual(defaultRule.condition.resourceTypes, [
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

test('DNR path case sensitivity agrees with conflict detection', () => {
  const upperRule = { ...sampleRules[0], pathPrefix: '/API' };
  const lowerRule = { ...sampleRules[0], id: 3, pathPrefix: '/api', headerValue: 'different' };

  assert.equal(areRulesConflicting(upperRule, lowerRule), false);
  assert.equal(validateRuleDraft(lowerRule, [upperRule]).ok, true);

  const { condition } = buildDynamicRule(upperRule);
  const pattern = new RegExp(condition.regexFilter, condition.isUrlFilterCaseSensitive ? '' : 'i');
  assert.match('https://api.example.com/API/users', pattern);
  assert.doesNotMatch('https://api.example.com/api/users', pattern);
});
