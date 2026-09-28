import { sendRuntimeMessage } from './chrome-api.js';
import { ACTIVATION_MESSAGE_GET, ACTIVATION_MESSAGE_SET } from './messages.js';

/**
 * Activation changes go through the service worker rather than straight to
 * storage, because the worker owns the declarativeNetRequest rule set and the
 * badges. Writing storage directly would leave both stale.
 */
export function getActivationState() {
  return sendActivationMessage({ type: ACTIVATION_MESSAGE_GET });
}

export function setActivationState(activation) {
  return sendActivationMessage({ type: ACTIVATION_MESSAGE_SET, activation });
}

async function sendActivationMessage(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not update the ReqKit switch.');
  }

  return response.activation;
}
