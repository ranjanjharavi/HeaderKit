import { getRulesForOriginGrant } from '../../shared/domain/site-access.js';
import { removeOriginPermission } from '../../shared/runtime/chrome-api.js';
import { createSerialQueue } from '../../shared/runtime/serial-queue.js';

/** Serializes feature refreshes and revokes grants without deleting saved rules. */
export function createSiteAccessActions({
  getState,
  setGrantedOrigins,
  refreshState,
  removePermission = removeOriginPermission,
  onError = (...args) => console.error(...args)
}) {
  const enqueueRefresh = createSerialQueue();

  function refresh() {
    return enqueueRefresh(() => refreshState());
  }

  function prepareRevocation(origin) {
    const { rules, grantedOrigins } = getState();
    if (!(grantedOrigins instanceof Set) || !grantedOrigins.has(origin)) {
      return null;
    }
    return { origin, ruleCount: getRulesForOriginGrant(rules, origin).length };
  }

  async function revoke(origin) {
    const knownOrigins = new Set(getState().grantedOrigins);
    knownOrigins.delete(origin);
    if (!(await removePermission(origin))) {
      throw new Error('Chrome did not remove this site access grant.');
    }
    try {
      await refresh();
    } catch (error) {
      onError('Could not refresh rules after revoking site access.', error);
    }
    const current = getState().grantedOrigins;
    if (current instanceof Set) {
      current.delete(origin);
    }
    setGrantedOrigins(current instanceof Set ? current : knownOrigins);
  }

  return { refresh, prepareRevocation, revoke };
}
