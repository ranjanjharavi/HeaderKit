import { sendRuntimeMessage } from './chrome-api.js';

export async function sendProfileIntent(message) {
  const response = await sendRuntimeMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not update profiles.');
  }
  return response;
}