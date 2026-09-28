import { sendRuntimeMessage } from './chrome-api.js';
import { RULE_MESSAGE_COMMIT, RULE_MESSAGE_GET } from './messages.js';

export function getStoredRules() {
  return sendRuleMessage({ type: RULE_MESSAGE_GET });
}

export function commitRules(rules) {
  return sendRuleMessage({ type: RULE_MESSAGE_COMMIT, rules });
}

async function sendRuleMessage(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not update header rules.');
  }

  return response.rules || [];
}
