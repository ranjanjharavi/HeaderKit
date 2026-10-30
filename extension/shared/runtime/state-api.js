import { sendRuntimeMessage } from './chrome-api.js';
import { readGrantedOrigins } from './site-access-api.js';
import { STATE_MESSAGE_GET } from './messages.js';

export async function getStateSnapshot() {
  const response = await sendRuntimeMessage({ type: STATE_MESSAGE_GET });
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not read HeaderKit state.');
  }
  return { rules: response.rules, profiles: response.profiles, activation: response.activation };
}

export function createStateRefresh(applySnapshot) {
  let latestRequest = 0;
  let scheduled = false;

  async function refresh() {
    const request = ++latestRequest;
    const [snapshot, grantedOrigins] = await Promise.all([getStateSnapshot(), readGrantedOrigins()]);
    if (request !== latestRequest) {
      return false;
    }
    applySnapshot({ ...snapshot, grantedOrigins });
    return true;
  }

  function schedule() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    latestRequest++;
    queueMicrotask(() => {
      scheduled = false;
      refresh().catch((error) => console.error('Could not refresh HeaderKit state.', error));
    });
  }

  return { refresh, schedule };
}
