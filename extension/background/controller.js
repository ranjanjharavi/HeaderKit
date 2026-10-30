import { mergeBackup, parseBackup, serializeBackup } from '../shared/domain/backup.js';
import { setMasterEnabled } from '../shared/domain/activation.js';
import { getRuleOriginPattern } from '../shared/domain/rules.js';
import { STATE_MESSAGE_GET } from '../shared/runtime/messages.js';
import { applyRuleIntent, commitRuleSet } from './rule-commit.js';
import { applyActivationIntent, applyProfileIntent, commitState } from './state-commit.js';

export const EXPIRY_ALARM = 'headerkit:activation-expiry';

/** Worker workflows only: the entry point registers events and serializes every call. */
export function createWorkerController({
  stateStore,
  applyRules,
  badges,
  clearAlarm,
  createAlarm,
  removeOriginPermission,
  onError
}) {
  async function initialize({ newBrowserSession = false } = {}) {
    await stateStore.migrate();
    stateStore.invalidate();
    const state = await stateStore.load({ newBrowserSession });
    await applyState(state);
    badges.refresh();
    await scheduleExpiryAlarm(state.activation);
  }

  async function handleBackupExport() {
    return serializeBackup(await stateStore.readBackupData());
  }

  async function handleBackupImport(message) {
    // Validate before loading state, so invalid imports cannot resolve timers.
    const backup = parseBackup(message.text);
    const state = await stateStore.load();
    const nextState = mergeBackup(backup, state);
    await persistState(nextState, state);
    return {
      profileCount: nextState.profiles.length - state.profiles.length,
      ruleCount: nextState.rules.length - state.rules.length
    };
  }

  async function handleRuleMessage(message) {
    const state = await stateStore.load();
    const result = applyRuleIntent(message, state);
    const rules = await commitRuleSet(result.rules, {
      activation: state.activation,
      profileIds: state.profileIds,
      getCurrentRules: async () => state.rules,
      applyRules: (nextRules) => applyRules(nextRules, state.activation, state.grantedOrigins),
      storeRules: stateStore.storeRules
    });
    await releaseUnusedPermissions(state.rules, rules);
    badges.refresh();
    return { rules, rule: result.rule };
  }

  async function handleActivationMessage(message) {
    const state = await stateStore.load();
    const activation = applyActivationIntent(message, state);
    await persistState({ ...state, activation }, state);
    return activation;
  }

  async function handleStateMessage(message) {
    const state = await stateStore.load();
    if (message.type === STATE_MESSAGE_GET) {
      return state;
    }
    const nextState = applyProfileIntent(message, state);
    await persistState(nextState, state);
    await releaseUnusedPermissions(state.rules, nextState.rules);
    return nextState;
  }

  async function toggleMasterSwitch() {
    const state = await stateStore.load();
    const activation = setMasterEnabled(state.activation, !state.activation.masterEnabled);
    await persistState({ ...state, activation }, state);
  }

  // load() persists elapsed timers before the applied rules and badges use them.
  async function applyExpiry() {
    const state = await stateStore.load();
    await applyState(state);
    badges.refresh();
    await scheduleExpiryAlarm(state.activation);
  }

  async function refreshAfterPermissionChange() {
    const state = await stateStore.load();
    await applyState(state);
    badges.refresh();
  }

  function applyState(state) {
    return applyRules(state.rules, state.activation, state.grantedOrigins);
  }

  async function persistState(nextState, previousState) {
    await commitState(nextState, previousState, { applyState, storeState: stateStore.storeState });
    badges.refresh();
    await scheduleExpiryAlarm(nextState.activation);
  }

  async function scheduleExpiryAlarm(activation) {
    try {
      await clearAlarm(EXPIRY_ALARM);
      if (activation?.expiresAt) {
        await createAlarm(EXPIRY_ALARM, { when: activation.expiresAt });
      }
    } catch (error) {
      onError('Could not schedule the activation timer.', error);
    }
  }

  async function releaseUnusedPermissions(previousRules, rules) {
    const remainingDomains = new Set(rules.map((rule) => rule.domain));
    const origins = new Set(
      previousRules.filter((rule) => !remainingDomains.has(rule.domain)).map(getRuleOriginPattern)
    );
    await Promise.all(
      [...origins].map(async (origin) => {
        try {
          await removeOriginPermission(origin);
        } catch (error) {
          onError(`Could not release site access for ${origin}.`, error);
        }
      })
    );
  }

  return {
    initialize,
    handleBackupExport,
    handleBackupImport,
    handleRuleMessage,
    handleActivationMessage,
    handleStateMessage,
    toggleMasterSwitch,
    applyExpiry,
    refreshAfterPermissionChange
  };
}
