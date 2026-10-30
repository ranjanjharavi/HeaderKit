import { createDefaultActivation, getTargetProfileId } from '../shared/domain/activation.js';
import { filterRulesByProfile, getActiveRuleConflicts, groupRulesByDomain } from '../shared/domain/rules.js';
import { createConflictMap, createDomainGroupModel, sortDomainGroups } from '../shared/ui/rule-view-model.js';

const SEARCH_VISIBLE_FROM = 5;

export function getRuleWorkspaceViewModel({
  rules = [],
  profiles = [],
  activation = null,
  searchQuery = '',
  editingId = null,
  composerOpen = false,
  collapsedDomains = new Set(),
  revealedRuleIds = new Set(),
  grantedOrigins = null
}) {
  const resolvedActivation = activation || createDefaultActivation();
  const scopedRules = filterRulesByProfile(rules, getTargetProfileId(resolvedActivation));
  const summary = getRuleWorkspaceSummary(scopedRules);
  const searchEnabled = summary.totalRules >= SEARCH_VISIBLE_FROM;
  const effectiveQuery = searchEnabled ? searchQuery : '';
  const conflictMap = createConflictMap(getActiveRuleConflicts(rules, resolvedActivation));
  const conflictingIds = new Set(conflictMap.keys());
  const visibleRules = filterRulesBySearch(scopedRules, effectiveQuery);
  const editingRule = rules.find((rule) => rule.id === editingId);
  if (editingRule && !visibleRules.some((rule) => rule.id === editingRule.id)) {
    visibleRules.push(editingRule);
  }
  return {
    summary,
    searchEnabled,
    searchQuery: effectiveQuery,
    editingId,
    addRuleDisabled: composerOpen || editingId !== null,
    groups: sortDomainGroups(groupRulesByDomain(visibleRules), conflictingIds, '').map(
      ({ domain, rules: domainRules }, index) =>
        createDomainGroupModel(domain, domainRules, {
          index,
          conflictMap,
          collapsed: collapsedDomains.has(domain),
          editingId,
          revealedRuleIds,
          editProfiles: profiles,
          managerView: true,
          grantedOrigins
        })
    )
  };
}

function filterRulesBySearch(rules, query) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase();
  if (!normalizedQuery) {
    return rules;
  }
  return rules.filter((rule) =>
    [rule.domain, rule.headerName].some((value) => String(value).toLowerCase().includes(normalizedQuery))
  );
}

export function getRuleWorkspaceSummary(rules) {
  const safeRules = Array.isArray(rules) ? rules : [];
  const totalRules = safeRules.length;
  const activeRules = safeRules.filter((rule) => rule.enabled).length;
  const hostCount = new Set(safeRules.map((rule) => rule.domain)).size;

  if (!totalRules) {
    return {
      totalRules,
      activeRules,
      hostCount,
      detail: 'No rules in this view.'
    };
  }

  return {
    totalRules,
    activeRules,
    hostCount,
    detail: `${totalRules} ${totalRules === 1 ? 'rule' : 'rules'} applying to ${hostCount} ${hostCount === 1 ? 'host' : 'hosts'}`
  };
}
