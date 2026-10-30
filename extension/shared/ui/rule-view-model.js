import { isRuleGranted } from '../domain/site-access.js';

export function isSensitiveHeaderName(headerName) {
  return /(auth|session|passw(or)?d|secret|signature|csrf|xsrf|bearer|jwt|credential|private|api[-_]?key|token|cookie)/i.test(
    String(headerName || '')
  );
}

export function sortRulesForDisplay(rules, conflictingIds = new Set()) {
  return [...rules].sort((leftRule, rightRule) => {
    const conflictDifference = Number(conflictingIds.has(rightRule.id)) - Number(conflictingIds.has(leftRule.id));
    return conflictDifference || Number(rightRule.enabled) - Number(leftRule.enabled);
  });
}

export function sortDomainGroups(groups, conflictingIds, currentHostname) {
  return [...groups].sort((leftGroup, rightGroup) => {
    const leftHasConflict = leftGroup.rules.some((rule) => conflictingIds.has(rule.id));
    const rightHasConflict = rightGroup.rules.some((rule) => conflictingIds.has(rule.id));
    const conflictDifference = Number(rightHasConflict) - Number(leftHasConflict);
    if (conflictDifference) {
      return conflictDifference;
    }
    const currentSiteDifference =
      Number(rightGroup.domain === currentHostname) - Number(leftGroup.domain === currentHostname);
    return currentSiteDifference || leftGroup.domain.localeCompare(rightGroup.domain);
  });
}

export function createConflictMap(conflicts) {
  const conflictMap = new Map();
  conflicts.forEach(({ leftRule, rightRule }) => {
    conflictMap.set(leftRule.id, [...(conflictMap.get(leftRule.id) || []), rightRule]);
    conflictMap.set(rightRule.id, [...(conflictMap.get(rightRule.id) || []), leftRule]);
  });
  return conflictMap;
}

export function createRuleRowModel(
  rule,
  {
    conflictMap = new Map(),
    revealedRuleIds = new Set(),
    editingId = null,
    editProfiles = null,
    grantedOrigins = null
  } = {}
) {
  return {
    rule,
    options: {
      conflictingRules: conflictMap.get(rule.id) || [],
      revealed: revealedRuleIds.has(rule.id),
      editing: rule.id === editingId,
      editProfiles,
      // Unknown grants must not mislabel every rule as broken.
      needsAccess: Boolean(grantedOrigins) && !isRuleGranted(rule, grantedOrigins)
    }
  };
}

export function createDomainGroupModel(
  domain,
  domainRules,
  {
    index,
    conflictMap = new Map(),
    collapsed = false,
    currentHostname = '',
    editingId = null,
    revealedRuleIds = new Set(),
    editProfiles = null,
    managerView = false,
    grantedOrigins = null
  } = {}
) {
  const conflictingIds = new Set(conflictMap.keys());
  const sortedRules = sortRulesForDisplay(domainRules, conflictingIds);
  const hasEditingRule = domainRules.some((rule) => rule.id === editingId);
  const activeCount = domainRules.filter((rule) => rule.enabled).length;
  const pausedCount = domainRules.length - activeCount;
  const conflictCount = domainRules.reduce((count, rule) => count + (conflictMap.get(rule.id)?.length || 0), 0) / 2;
  return {
    domain,
    groupId: `domainRuleGroup-${index}`,
    collapsed: collapsed && !hasEditingRule,
    currentSite: domain === currentHostname,
    conflictCount,
    conflictLabel: conflictCount === 1 ? 'conflict' : 'conflicts',
    summary: managerView
      ? `${domainRules.length} ${domainRules.length === 1 ? 'rule' : 'rules'} · ${activeCount} on`
      : [activeCount ? `${activeCount} active` : '', pausedCount ? `${pausedCount} paused` : '']
          .filter(Boolean)
          .join(' · '),
    rows: sortedRules.map((rule) =>
      createRuleRowModel(rule, { conflictMap, revealedRuleIds, editingId, editProfiles, grantedOrigins })
    )
  };
}
