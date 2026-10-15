import { sendRuntimeMessage } from './chrome-api.js';

export async function sendRuleIntent(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw Object.assign(new Error(response?.error || 'Could not update header rules.'), {
      field: response?.field,
      conflictId: response?.conflictId
    });
  }
  return response;
}
