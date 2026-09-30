import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterGrantedRules,
  filterOriginGrants,
  getMissingProfileOrigins,
  getRulesForOriginGrant,
  isBroadOrigin,
  getProfileOrigins,
  isOriginGranted,
  isRuleGranted
} from '../../extension/shared/domain/site-access.js';

const rules = [
  { id: 1, domain: 'api.example.com', headerName: 'X-A', headerValue: 'a', enabled: true, profileId: 'default' },
  { id: 2, domain: 'api.example.com', headerName: 'X-B', headerValue: 'b', enabled: true, profileId: 'default' },
  { id: 3, domain: 'cdn.example.net', headerName: 'X-C', headerValue: 'c', enabled: true, profileId: 'default' },
  { id: 4, domain: 'staging.acme.io', headerName: 'X-D', headerValue: 'd', enabled: true, profileId: 'staging' }
];

test('a profile needs one origin per distinct host', () => {
  assert.deepEqual(getProfileOrigins(rules, 'default'), [
    'https://api.example.com/*',
    'https://cdn.example.net/*'
  ]);
  assert.deepEqual(getProfileOrigins(rules, 'staging'), ['https://staging.acme.io/*']);
  assert.deepEqual(getProfileOrigins(rules, 'missing'), []);
});

test('only the origins not already granted are requested', () => {
  const granted = new Set(['https://api.example.com/*']);

  assert.deepEqual(getMissingProfileOrigins(rules, 'default', granted), ['https://cdn.example.net/*']);
  assert.deepEqual(getMissingProfileOrigins(rules, 'staging', granted), ['https://staging.acme.io/*']);
});

test('nothing is requested when everything is already granted', () => {
  const granted = new Set(['https://api.example.com/*', 'https://cdn.example.net/*']);
  assert.deepEqual(getMissingProfileOrigins(rules, 'default', granted), []);
});

test('a broad grant covers every host', () => {
  assert.equal(isOriginGranted('https://anything.example.com/*', new Set(['https://*/*'])), true);
  assert.equal(isOriginGranted('https://anything.example.com/*', new Set(['<all_urls>'])), true);
  assert.deepEqual(getMissingProfileOrigins(rules, 'default', new Set(['https://*/*'])), []);
});

test('host-specific grants cover only the matching host rules', () => {
  assert.deepEqual(getRulesForOriginGrant(rules, 'https://api.example.com/*').map((rule) => rule.id), [1, 2]);
  assert.deepEqual(getRulesForOriginGrant(rules, 'https://unused.example.com/*'), []);
});

test('broad grants include wildcard subdomains', () => {
  assert.equal(isBroadOrigin('<all_urls>'), true);
  assert.equal(isBroadOrigin('https://*/*'), true);
  assert.equal(isBroadOrigin('https://*.example.com/*'), true);
  assert.equal(isBroadOrigin('https://api.example.com/*'), false);
});

test('site access search matches patterns, hosts, and broad grant labels', () => {
  const origins = [
    '<all_urls>',
    'https://*/*',
    'https://*.example.com/*',
    'https://api.example.com/*',
    'https://assets.example.net/*'
  ];

  assert.deepEqual(filterOriginGrants(origins, ''), origins);
  assert.deepEqual(filterOriginGrants(origins, 'API EXAMPLE'), ['https://api.example.com/*']);
  assert.deepEqual(filterOriginGrants(origins, 'api.example.com'), [
    '<all_urls>',
    'https://*/*',
    'https://*.example.com/*',
    'https://api.example.com/*'
  ]);
  assert.deepEqual(filterOriginGrants(origins, 'preview.example.com'), [
    '<all_urls>',
    'https://*/*',
    'https://*.example.com/*'
  ]);
  assert.deepEqual(filterOriginGrants(origins, 'example com'), [
    'https://*.example.com/*',
    'https://api.example.com/*'
  ]);
  assert.deepEqual(filterOriginGrants(origins, 'all websites'), ['<all_urls>']);
  assert.deepEqual(filterOriginGrants(origins, 'no match'), []);
});

test('broad and wildcard grants report every host they cover', () => {
  assert.deepEqual(getRulesForOriginGrant(rules, 'https://*/*').map((rule) => rule.id), [1, 2, 3, 4]);
  assert.deepEqual(getRulesForOriginGrant(rules, '<all_urls>').map((rule) => rule.id), [1, 2, 3, 4]);
  assert.deepEqual(
    getRulesForOriginGrant(rules, 'https://*.example.com/*').map((rule) => rule.id),
    [1, 2]
  );
  assert.equal(isOriginGranted('https://api.example.com/*', new Set(['https://*.example.com/*'])), true);
  assert.equal(isOriginGranted('https://badexample.com/*', new Set(['https://*.example.com/*'])), false);
});

test('a rule is granted only when its own host is', () => {
  const granted = new Set(['https://api.example.com/*']);

  assert.equal(isRuleGranted(rules[0], granted), true);
  assert.equal(isRuleGranted(rules[2], granted), false);
  assert.equal(isRuleGranted(rules[0], new Set()), false);
});

test('filtering keeps only rules ReqKit can actually apply', () => {
  const granted = new Set(['https://api.example.com/*']);

  assert.deepEqual(filterGrantedRules(rules, granted).map((rule) => rule.id), [1, 2]);
  assert.deepEqual(filterGrantedRules(rules, new Set()), []);
});

test('an unknown grant list is treated as no restriction', () => {
  assert.equal(filterGrantedRules(rules, null).length, 4);
  assert.equal(filterGrantedRules(rules, undefined).length, 4);
});
