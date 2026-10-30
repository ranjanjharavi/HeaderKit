import { getRuleOriginPattern } from '../domain/rules.js';

/**
 * Start the durable rule commit before opening Chrome's permission UI, without
 * awaiting between the two calls. Chrome requires the permission request to
 * stay attached to the user's click, while the early commit lets the service
 * worker finish saving if Chrome dismisses the extension popup.
 */
export async function saveRuleBeforePermissionPrompt(rule, saveRule, { requestPermission }) {
  const persistence = settleCall(saveRule);
  const permission = settleCall(() => requestPermission(getRuleOriginPattern(rule)));
  const [persistenceResult, permissionResult] = await Promise.allSettled([persistence, permission]);

  if (persistenceResult.status === 'rejected') {
    throw persistenceResult.reason;
  }

  return {
    granted: permissionResult.status === 'fulfilled' && Boolean(permissionResult.value),
    permissionError: permissionResult.status === 'rejected' ? permissionResult.reason : null
  };
}

function settleCall(callback) {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error);
  }
}
