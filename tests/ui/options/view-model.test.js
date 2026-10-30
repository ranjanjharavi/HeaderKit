import assert from 'node:assert/strict';
import test from 'node:test';

import { getRuleWorkspaceSummary } from '../../../extension/options/view-model.js';

test('rule workspace summary describes an empty view', () => {
  assert.deepEqual(getRuleWorkspaceSummary([]), {
    totalRules: 0,
    activeRules: 0,
    hostCount: 0,
    detail: 'No rules in this view.'
  });
});

test('rule workspace summary handles host grammar and enabled counts', () => {
  assert.deepEqual(
    getRuleWorkspaceSummary([
      { domain: 'api.example.com', enabled: true },
      { domain: 'api.example.com', enabled: false }
    ]),
    {
      totalRules: 2,
      activeRules: 1,
      hostCount: 1,
      detail: '2 rules applying to 1 host'
    }
  );

  assert.deepEqual(
    getRuleWorkspaceSummary([
      { domain: 'api.example.com', enabled: true },
      { domain: 'staging.example.com', enabled: true }
    ]),
    {
      totalRules: 2,
      activeRules: 2,
      hostCount: 2,
      detail: '2 rules applying to 2 hosts'
    }
  );
});
