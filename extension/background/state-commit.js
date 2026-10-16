import {
  DEFAULT_PROFILE_ID,
  cloneRulesIntoProfile,
  createProfile,
  validateProfileDraft
} from '../shared/domain/profiles.js';
import { getActiveRuleConflicts, getNextRuleId, getRuleConflictMessage } from '../shared/domain/rules.js';
import { setActiveProfile, setActivationDuration, setMasterEnabled } from '../shared/domain/activation.js';
import {
  ACTIVATION_MESSAGE_SET_MASTER,
  ACTIVATION_MESSAGE_SET_PROFILE,
  ACTIVATION_MESSAGE_SET_DURATION,
  PROFILE_MESSAGE_CREATE,
  PROFILE_MESSAGE_RENAME,
  PROFILE_MESSAGE_DUPLICATE,
  PROFILE_MESSAGE_DELETE
} from '../shared/runtime/messages.js';

export function applyProfileIntent(message, state) {
  const source = state.profiles.find((profile) => profile.id === message.id);
  if (message.type !== PROFILE_MESSAGE_CREATE && !source) {
    throw new Error('That profile no longer exists.');
  }
  if (message.type === PROFILE_MESSAGE_DELETE) {
    if (message.id === DEFAULT_PROFILE_ID) {
      throw new Error('The Default profile cannot be deleted.');
    }
    let activation = state.activation;
    if (activation.profileId === message.id) {
      activation = setActiveProfile(activation, DEFAULT_PROFILE_ID);
    } else if (activation.lastProfileId === message.id) {
      activation = { ...activation, lastProfileId: DEFAULT_PROFILE_ID };
    }
    return {
      ...state,
      profiles: state.profiles.filter((profile) => profile.id !== message.id),
      rules: state.rules.filter((rule) => rule.profileId !== message.id),
      activation
    };
  }
  if (![PROFILE_MESSAGE_CREATE, PROFILE_MESSAGE_RENAME, PROFILE_MESSAGE_DUPLICATE].includes(message.type)) {
    throw new Error('Unknown profile request.');
  }
  const validation = validateProfileDraft({ name: message.name }, state.profiles, {
    excludeId: message.type === PROFILE_MESSAGE_RENAME ? message.id : null
  });
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  if (message.type === PROFILE_MESSAGE_RENAME) {
    const profile = { ...source, name: validation.profile.name };
    return {
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === source.id ? profile : candidate),
      profile
    };
  }
  const profile = createProfile(validation.profile.name);
  if (state.profiles.some((candidate) => candidate.id === profile.id)) {
    throw new Error('Could not allocate a profile. Try again.');
  }
  let rules = state.rules;
  if (message.type === PROFILE_MESSAGE_DUPLICATE) {
    const clonedRules = cloneRulesIntoProfile(rules, message.id, profile.id, getNextRuleId(rules))
      .map((rule) => ({ ...rule, enabled: false }));
    rules = [...rules, ...clonedRules];
  }
  return { ...state, profiles: [...state.profiles, profile], rules, profile };
}

export function applyActivationIntent(message, state) {
  if (message.type === ACTIVATION_MESSAGE_SET_MASTER) {
    if (typeof message.enabled !== 'boolean') {
      throw new TypeError('Choose whether ReqKit is enabled.');
    }
    return setMasterEnabled(state.activation, message.enabled);
  }
  if (message.type === ACTIVATION_MESSAGE_SET_PROFILE) {
    if (message.profileId !== null && !state.profileIds.has(message.profileId)) {
      throw new Error('That profile no longer exists.');
    }
    return setActiveProfile(state.activation, message.profileId);
  }
  if (message.type === ACTIVATION_MESSAGE_SET_DURATION) {
    return setActivationDuration(state.activation, getDurationOptions(message));
  }
  throw new Error('Unknown activation request.');
}

function getDurationOptions({ durationMs = null, untilBrowserClose = false }) {
  if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs <= 0)) {
    throw new TypeError('Choose a valid activation duration.');
  }
  if (typeof untilBrowserClose !== 'boolean') {
    throw new TypeError('Choose a valid activation duration.');
  }
  if (durationMs !== null && untilBrowserClose) {
    throw new Error('Choose one activation duration.');
  }
  return { durationMs, untilBrowserClose };
}

export async function commitState(nextState, previousState, { applyState, storeState }) {
  const [conflict] = getActiveRuleConflicts(nextState.rules, nextState.activation);
  if (conflict) {
    throw new Error(getRuleConflictMessage(conflict.leftRule));
  }
  await applyState(nextState);
  try {
    await storeState(nextState);
  } catch (error) {
    try {
      await applyState(previousState);
    } catch (rollbackError) {
      console.error('Could not restore the previous dynamic rules.', rollbackError);
    }
    throw error;
  }
  return nextState;
}