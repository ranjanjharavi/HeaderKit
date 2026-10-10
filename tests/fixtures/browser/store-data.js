// Fictional data for marketing captures of the real extension UI.
// This module is served by the local preview only; it is never packaged.
export function createStoreData() {
  return {
    privacyConsentVersion: 1,
    profiles: [
      { id: 'default', name: 'Staging', createdAt: 0, defaultDurationMs: null },
      { id: 'qa', name: 'QA', createdAt: 1, defaultDurationMs: null },
      { id: 'development', name: 'Development', createdAt: 2, defaultDurationMs: null }
    ],
    activation: {
      masterEnabled: true,
      profileId: 'default',
      lastProfileId: 'default',
      expiresAt: Date.now() + 3600000,
      durationMs: 3600000,
      untilBrowserClose: false
    },
    headerRules: [
      { id: 1, domain: 'api.example.com', headerName: 'X-Environment', headerValue: 'staging', pathPrefix: '/api/v1', resourceType: 'xmlhttprequest', enabled: true, profileId: 'default' },
      { id: 2, domain: 'api.example.com', headerName: 'X-Debug-Mode', headerValue: 'enabled', enabled: true, profileId: 'default' },
      { id: 3, domain: 'api.example.com', headerName: 'X-Trace', headerValue: 'verbose', enabled: false, profileId: 'default' },
      { id: 4, domain: 'qa.example.com', headerName: 'X-Environment', headerValue: 'qa', enabled: true, profileId: 'qa' },
      { id: 5, domain: 'qa.example.com', headerName: 'X-Debug-Mode', headerValue: 'enabled', enabled: false, profileId: 'qa' },
      { id: 6, domain: 'localhost', headerName: 'X-Debug-Mode', headerValue: 'enabled', enabled: false, profileId: 'development' }
    ]
  };
}
