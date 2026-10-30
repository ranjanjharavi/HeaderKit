// Fresh, canonical data shared by domain, runtime, and worker backup tests.
export function createBackupFixture() {
  return {
    format: 'headerkit',
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    profiles: [
      { id: 'default', name: 'Default', createdAt: 0, defaultDurationMs: null },
      { id: 'qa', name: 'QA', createdAt: 1_700_000_000_000, defaultDurationMs: 3_600_000 }
    ],
    rules: [
      {
        id: 1,
        profileId: 'default',
        domain: 'api.example.com',
        headerName: 'Authorization',
        headerValue: 'Bearer backup-test-secret',
        pathPrefix: '',
        resourceType: 'all',
        enabled: true
      },
      {
        id: 4,
        profileId: 'qa',
        domain: 'api.example.com',
        headerName: 'X-Environment',
        headerValue: 'staging',
        pathPrefix: '/api/v1',
        resourceType: 'xmlhttprequest',
        enabled: true
      },
      {
        id: 9,
        profileId: 'qa',
        domain: 'staging.example.com',
        headerName: 'X-Debug',
        headerValue: 'disabled',
        pathPrefix: '',
        resourceType: 'all',
        enabled: false
      }
    ]
  };
}
