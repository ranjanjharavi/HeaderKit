import {
  formatRemainingTime,
  getRemainingMs,
  getTargetProfileId
} from '../shared/domain/activation.js';
import { getProfileName } from '../shared/domain/profiles.js';

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
  return targetSection
    ? `options/index.html#${encodeURIComponent(targetSection)}`
    : 'options/index.html';
}
