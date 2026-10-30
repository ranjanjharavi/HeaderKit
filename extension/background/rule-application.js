import { getLiveRules } from '../shared/domain/activation.js';
import { buildDynamicRule } from '../shared/domain/rules.js';
import { filterGrantedRules } from '../shared/domain/site-access.js';

/** Reconciles Chrome's two applied rulesets; persistence and serialization belong to the caller. */
export function createRuleApplication({
  getDynamicRules,
  getSessionRules,
  updateDynamicRules,
  updateSessionRules,
  getRegexRuleLimit,
  onError
}) {
  return async function applyRules(rules, activation, grantedOrigins) {
    const [dynamicRules, sessionRules] = await Promise.all([getDynamicRules(), getSessionRules()]);
    const applicableRules = filterGrantedRules(rules, grantedOrigins);
    const addRules = getLiveRules(applicableRules, activation).map(buildDynamicRule);
    const regexLimit = getRegexRuleLimit();
    if (addRules.length > regexLimit) {
      throw new Error(`Chrome supports at most ${regexLimit} active header rules. Pause or remove some rules first.`);
    }

    let activeRules = dynamicRules;
    let inactiveRules = sessionRules;
    let updateActive = updateDynamicRules;
    let updateInactive = updateSessionRules;
    if (activation.untilBrowserClose) {
      activeRules = sessionRules;
      inactiveRules = dynamicRules;
      updateActive = updateSessionRules;
      updateInactive = updateDynamicRules;
    }
    if (inactiveRules.length) {
      await updateInactive({ removeRuleIds: inactiveRules.map((rule) => rule.id), addRules: [] });
    }
    try {
      await updateActive({ removeRuleIds: activeRules.map((rule) => rule.id), addRules });
    } catch (error) {
      if (inactiveRules.length) {
        try {
          await updateInactive({ removeRuleIds: [], addRules: inactiveRules });
        } catch (rollbackError) {
          onError('Could not restore the previous applied rules.', rollbackError);
        }
      }
      throw error;
    }
  };
}
