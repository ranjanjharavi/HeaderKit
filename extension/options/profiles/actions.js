import {
  DEFAULT_PROFILE_ID,
  countRulesInProfile,
  getProfileName,
  validateProfileDraft
} from '../../shared/domain/profiles.js';
import { createDefaultActivation } from '../../shared/domain/activation.js';
import { getMissingProfileOrigins } from '../../shared/domain/site-access.js';
import { requestOriginPermissions } from '../../shared/runtime/chrome-api.js';
import { setActiveProfile } from '../../shared/runtime/activation-api.js';
import { sendProfileIntent } from '../../shared/runtime/profile-api.js';
import { readGrantedOrigins } from '../../shared/runtime/site-access-api.js';
import {
  PROFILE_MESSAGE_CREATE,
  PROFILE_MESSAGE_RENAME,
  PROFILE_MESSAGE_DUPLICATE,
  PROFILE_MESSAGE_DELETE
} from '../../shared/runtime/messages.js';

/** Profile workflows receive state and runtime dependencies, never form elements. */
export function createProfileActions({
  getState,
  setGrantedOrigins,
  refreshState,
  sendIntent = sendProfileIntent,
  requestOrigins = requestOriginPermissions,
  readOrigins = readGrantedOrigins,
  setProfile = setActiveProfile,
  onError = (...args) => console.error(...args)
}) {
  function prepareSave({ mode, id }, name) {
    const validation = validateProfileDraft({ name }, getState().profiles, {
      excludeId: mode === 'rename' ? id : null
    });
    return validation.ok ? { ok: true, mode, id, name: validation.profile.name } : validation;
  }

  async function save({ mode, id, name }) {
    if (mode === 'create') {
      const result = await sendIntent({ type: PROFILE_MESSAGE_CREATE, name });
      await refreshState();
      return { mode, name, profile: result.profile };
    }

    const source = getState().profiles.find((profile) => profile.id === id);
    if (!source) {
      throw new Error('That profile no longer exists.');
    }
    if (mode === 'rename') {
      if (source.name === name) {
        return { mode, name, profile: source, unchanged: true };
      }
      await sendIntent({ type: PROFILE_MESSAGE_RENAME, id, name });
      await refreshState();
      return { mode, name, profile: { ...source, name } };
    }

    const result = await sendIntent({ type: PROFILE_MESSAGE_DUPLICATE, id, name });
    await refreshState();
    return {
      mode,
      profile: result.profile,
      sourceId: id,
      sourceName: source.name,
      copiedCount: countRulesInProfile(result.rules, result.profile.id)
    };
  }

  function prepareDeletion(id) {
    const { profiles, rules } = getState();
    const profile = profiles.find((candidate) => candidate.id === id);
    return !profile || id === DEFAULT_PROFILE_ID ? null : { profile, ruleCount: countRulesInProfile(rules, id) };
  }

  async function remove(id) {
    await sendIntent({ type: PROFILE_MESSAGE_DELETE, id });
    await refreshState();
  }

  async function activate(id) {
    const state = getState();
    const activation = state.activation || createDefaultActivation();
    if (id === activation.profileId) {
      return null;
    }

    // No await before requesting: keep the request attached to the click task.
    const missingOrigins = getMissingProfileOrigins(state.rules, id, state.grantedOrigins);
    let granted = true;
    if (missingOrigins.length) {
      try {
        granted = await requestOrigins(missingOrigins);
      } catch (error) {
        onError('Could not request site access for that profile.', error);
        granted = false;
      }
      setGrantedOrigins(await readOrigins());
    }

    await setProfile(id);
    await refreshState();
    return { name: getProfileName(getState().profiles, id), granted };
  }

  return { prepareSave, save, prepareDeletion, remove, activate };
}
