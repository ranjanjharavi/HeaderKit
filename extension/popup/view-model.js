import {
  createDefaultActivation,
  formatRemainingTime,
  getRemainingMs,
  getTargetProfileId
} from '../shared/domain/activation.js';
import {
  filterRulesByHost,
  filterRulesByProfile,
  getActiveRuleConflicts,
  groupRulesByDomain
} from '../shared/domain/rules.js';
import {
  createConflictMap,
  createDomainGroupModel,
  createRuleRowModel,
  sortDomainGroups,
  sortRulesForDisplay
} from '../shared/ui/rule-view-model.js';
import { getProfileName } from '../shared/domain/profiles.js';

export function getPopupRuleViewModel({
  rules = [],
  activation = null,
  scope = 'site',
  currentHostname = '',
  composerOpen = false,
  collapsedDomains = new Set(),
  revealedRuleIds = new Set(),
  grantedOrigins = null
}) {
  const resolvedActivation = activation || createDefaultActivation();
  const effectiveScope = !currentHostname && scope === 'site' ? 'all' : scope;
  const scopedRules = filterRulesByProfile(rules, getTargetProfileId(resolvedActivation));
  const currentSiteRules = currentHostname ? filterRulesByHost(scopedRules, currentHostname) : [];
  const visibleRules = effectiveScope === 'all' ? scopedRules : currentSiteRules;
  const conflictMap = createConflictMap(getActiveRuleConflicts(rules, resolvedActivation));
  const conflictingIds = new Set(conflictMap.keys());
  return {
    scope: effectiveScope,
    currentHostname,
    currentSiteCount: currentSiteRules.length,
    allRulesCount: scopedRules.length,
    managerLinkLabel: getManagerLinkLabel(rules.length),
    hasRules: rules.length > 0,
    addRuleDisabled: !currentHostname || composerOpen,
    visibleRuleCount: visibleRules.length,
    rows:
      effectiveScope === 'all'
        ? []
        : sortRulesForDisplay(visibleRules, conflictingIds).map((rule) =>
            createRuleRowModel(rule, { conflictMap, revealedRuleIds, grantedOrigins })
          ),
    groups:
      effectiveScope !== 'all'
        ? []
        : sortDomainGroups(groupRulesByDomain(visibleRules), conflictingIds, currentHostname).map(
            ({ domain, rules: domainRules }, index) =>
              createDomainGroupModel(domain, domainRules, {
                index,
                conflictMap,
                collapsed: collapsedDomains.has(domain),
                currentHostname,
                revealedRuleIds,
                grantedOrigins
              })
          )
  };
}

export function getActivationDisplay(profiles, activation, now = Date.now()) {
  const profileName = getProfileName(profiles, getTargetProfileId(activation));

  if (!activation?.masterEnabled || !activation.profileId) {
    return { profileName, appliedUntil: 'Paused' };
  }
  if (activation.untilBrowserClose) {
    return { profileName, appliedUntil: 'Chrome closes' };
  }

  const remainingMs = getRemainingMs(activation, now);
  if (remainingMs !== null) {
    return { profileName, appliedUntil: `${formatRemainingTime(remainingMs)} left` };
  }

  return { profileName, appliedUntil: 'Until turned off' };
}

export function getManagerLinkLabel(ruleCount) {
  if (ruleCount === 0) {
    return 'Manage profiles and rules →';
  }
  if (ruleCount === 1) {
    return 'Manage profiles and 1 rule →';
  }

  return `Manage profiles and all ${ruleCount} rules →`;
}

export function getManagerPath({ section = '' } = {}) {
  const targetSection = String(section).trim().replace(/^#/, '');
  return targetSection ? `options/index.html#${encodeURIComponent(targetSection)}` : 'options/index.html';
}
