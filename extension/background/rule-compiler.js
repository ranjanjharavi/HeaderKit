import { normalizePathPrefix, normalizeResourceType } from '../shared/domain/rules.js';

const REQUEST_RESOURCE_TYPES = [
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

/** Compile a business rule to Chrome DNR data; eligibility and application belong to the caller. */
export function buildDynamicRule(rule) {
  const pathCondition = normalizePathPrefix(rule.pathPrefix ?? '');
  const pathRegex = pathCondition ? `${escapeRegex(pathCondition)}(?:/|[?#]|$)` : '(?:[/?#]|$)';
  const resourceType = normalizeResourceType(rule.resourceType ?? 'all') || 'all';

  return {
    id: rule.id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: rule.headerName,
          operation: 'set',
          value: rule.headerValue
        }
      ]
    },
    condition: {
      resourceTypes: resourceType === 'all' ? REQUEST_RESOURCE_TYPES : [resourceType],
      isUrlFilterCaseSensitive: true,
      regexFilter: String.raw`^https:\/\/${escapeRegex(rule.domain)}(?::\d+)?${pathRegex}`
    }
  };
}

function escapeRegex(value) {
  return String(value).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
