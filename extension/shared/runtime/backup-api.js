import { sendRuntimeMessage } from './chrome-api.js';
import { BACKUP_MESSAGE_EXPORT, BACKUP_MESSAGE_IMPORT } from './messages.js';

export async function exportBackup() {
  const response = await sendRuntimeMessage({ type: BACKUP_MESSAGE_EXPORT });
  if (response?.ok !== true || typeof response.text !== 'string' || !response.text) {
    const message = typeof response?.error === 'string' && response.error
      ? response.error
      : 'Could not export a backup.';
    throw new Error(message);
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
