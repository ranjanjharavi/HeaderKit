import { sendRuntimeMessage } from './chrome-api.js';
import {
  ACTIVATION_MESSAGE_SET_MASTER,
  ACTIVATION_MESSAGE_SET_PROFILE,
  ACTIVATION_MESSAGE_SET_DURATION
} from './messages.js';

/**
 * Activation changes go through the service worker rather than straight to
 * storage, because the worker owns the declarativeNetRequest rule set and the
 * badges. Writing storage directly would leave both stale.
 */
export function setMasterEnabled(enabled) {
  return sendActivationMessage({ type: ACTIVATION_MESSAGE_SET_MASTER, enabled });
}

export function setActiveProfile(profileId) {
  return sendActivationMessage({ type: ACTIVATION_MESSAGE_SET_PROFILE, profileId });
}

export function setActivationDuration({ durationMs = null, untilBrowserClose = false }) {
  return sendActivationMessage({ type: ACTIVATION_MESSAGE_SET_DURATION, durationMs, untilBrowserClose });
}

async function sendActivationMessage(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not update the HeaderKit switch.');
  }

  return response.activation;
}
