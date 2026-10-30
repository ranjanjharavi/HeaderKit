import {
  ACTIVATION_MESSAGE_SET_MASTER,
  ACTIVATION_MESSAGE_SET_PROFILE,
  ACTIVATION_MESSAGE_SET_DURATION,
  PROFILE_MESSAGE_CREATE,
  PROFILE_MESSAGE_RENAME,
  PROFILE_MESSAGE_DUPLICATE,
  PROFILE_MESSAGE_DELETE,
  STATE_MESSAGE_GET,
  BACKUP_MESSAGE_EXPORT,
  BACKUP_MESSAGE_IMPORT,
  RULE_MESSAGE_ADD,
  RULE_MESSAGE_UPDATE,
  RULE_MESSAGE_SET_ENABLED,
  RULE_MESSAGE_DELETE
} from '../shared/runtime/messages.js';

/** Returns a synchronous Chrome listener; every accepted request uses the caller's queue. */
export function createMessageRouter({ extensionId, extensionRoot, enqueue, handlers, onError }) {
  const ruleRoute = {
    handle: handlers.handleRuleMessage,
    respond: (result) => ({ ok: true, ...result }),
    fail(error) {
      onError('Could not process the header rule request.', error);
      return {
        ok: false,
        error: error.message || 'Could not update header rules.',
        field: error.field,
        conflictId: error.conflictId
      };
    }
  };
  const activationRoute = {
    handle: handlers.handleActivationMessage,
    respond: (activation) => ({ ok: true, activation }),
    fail(error) {
      onError('Could not process the activation request.', error);
      return { ok: false, error: error.message || 'Could not update the HeaderKit switch.' };
    }
  };
  const stateRoute = {
    handle: handlers.handleStateMessage,
    respond: ({ rules, profiles, activation, profile }) => ({ ok: true, rules, profiles, activation, profile }),
    fail(error) {
      onError('Could not process the state request.', error);
      return { ok: false, error: error.message || 'Could not update profiles.' };
    }
  };
  const routes = new Map([
    [
      BACKUP_MESSAGE_EXPORT,
      {
        handle: handlers.handleBackupExport,
        respond: (text) => ({ ok: true, text }),
        fail(error) {
          // Neither backup payloads nor errors that might contain values are logged.
          onError('Could not export the backup.');
          return { ok: false, error: error.message || 'Could not export a backup.' };
        }
      }
    ],
    [
      BACKUP_MESSAGE_IMPORT,
      {
        handle: handlers.handleBackupImport,
        respond: (result) => ({ ok: true, ...result }),
        fail(error) {
          onError('Could not process the backup request.');
          return { ok: false, error: error.message || 'Could not process the backup.' };
        }
      }
    ]
  ]);
  for (const type of [RULE_MESSAGE_ADD, RULE_MESSAGE_UPDATE, RULE_MESSAGE_SET_ENABLED, RULE_MESSAGE_DELETE]) {
    routes.set(type, ruleRoute);
  }
  for (const type of [ACTIVATION_MESSAGE_SET_MASTER, ACTIVATION_MESSAGE_SET_PROFILE, ACTIVATION_MESSAGE_SET_DURATION]) {
    routes.set(type, activationRoute);
  }
  for (const type of [
    PROFILE_MESSAGE_CREATE,
    PROFILE_MESSAGE_RENAME,
    PROFILE_MESSAGE_DUPLICATE,
    PROFILE_MESSAGE_DELETE,
    STATE_MESSAGE_GET
  ]) {
    routes.set(type, stateRoute);
  }

  return function handleMessage(message, sender, sendResponse) {
    if (sender?.id !== extensionId || typeof sender?.url !== 'string' || !sender.url.startsWith(extensionRoot)) {
      return false;
    }
    const route = routes.get(message?.type);
    if (!route) {
      return false;
    }
    enqueue(() => route.handle(message))
      .then((result) => sendResponse(route.respond(result)))
      .catch((error) => sendResponse(route.fail(error)));
    return true;
  };
}
