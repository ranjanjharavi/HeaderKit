import { sendRuntimeMessage } from './chrome-api.js';
import { BACKUP_MESSAGE_EXPORT, BACKUP_MESSAGE_IMPORT } from './messages.js';

export async function exportBackup() {
  const response = await sendRuntimeMessage({ type: BACKUP_MESSAGE_EXPORT });
  if (response?.ok !== true || typeof response.text !== 'string' || !response.text) {
    const message =
      typeof response?.error === 'string' && response.error ? response.error : 'Could not export a backup.';
    throw new Error(message);
  }
  return response.text;
}

export async function importBackup(text) {
  const response = await sendRuntimeMessage({ type: BACKUP_MESSAGE_IMPORT, text });
  if (response?.ok !== true) {
    const message =
      typeof response?.error === 'string' && response.error ? response.error : 'Could not import this backup.';
    throw new Error(message);
  }
  if (
    !Number.isSafeInteger(response.profileCount) ||
    response.profileCount < 1 ||
    !Number.isSafeInteger(response.ruleCount) ||
    response.ruleCount < 0
  ) {
    throw new Error('Could not confirm the import. Reload the rule manager before trying again.');
  }
  return { profileCount: response.profileCount, ruleCount: response.ruleCount };
}
