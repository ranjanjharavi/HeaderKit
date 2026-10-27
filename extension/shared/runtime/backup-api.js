import { sendRuntimeMessage } from './chrome-api.js';
import { BACKUP_MESSAGE_EXPORT, BACKUP_MESSAGE_IMPORT } from './messages.js';

export async function exportBackup() {
  const response = await sendRuntimeMessage({ type: BACKUP_MESSAGE_EXPORT });
  if (!response?.ok || typeof response.text !== 'string') {
    throw new Error(response?.error || 'Could not export a backup.');
  }
  return response.text;
}

export async function importBackup(text) {
  const response = await sendRuntimeMessage({ type: BACKUP_MESSAGE_IMPORT, text });
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not import this backup.');
  }
  return { profileCount: response.profileCount, ruleCount: response.ruleCount };
}
