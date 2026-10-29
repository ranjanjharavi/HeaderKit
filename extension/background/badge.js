import { countLiveRules, getTargetProfileId } from '../shared/domain/activation.js';
import { normalizeDomain } from '../shared/domain/rules.js';
import { filterGrantedRules } from '../shared/domain/site-access.js';

export const BADGE_ACTIVE_COLOR = '#2563eb';
export const BADGE_PAUSED_COLOR = '#64748b';

function runPendingWork(isPending, run) {
  return new Promise((resolve, reject) => {
    const step = () => {
      if (!isPending()) {
        resolve();
        return;
      }
      Promise.resolve().then(run).then(step, reject);
    };
    step();
  });
}

export function createBadgeController({ getState, queryTabs, getTab, action, onError }) {
  const jobs = new Map();
  const painted = new Map();
  const navigations = new Map();
  let navigationVersion = 0;
  let revision = 0;
  let refreshPending = false;
  let refreshJob = null;
  let reconciled = false;

  async function paintBadge(badge, tabId, job) {
    const target = tabId === null ? {} : { tabId };
    const previous = painted.get(tabId);
    if (tabId === null && badge.color && previous?.color !== badge.color) {
      await action.setBadgeBackgroundColor({ ...target, color: badge.color });
    }
    if (job.cancelled) {
      return;
    }
    if (previous?.text !== badge.text) {
      await action.setBadgeText({ ...target, text: badge.text });
    }
    if (!job.cancelled) {
      painted.set(tabId, badge);
    }
  }

  function scheduleTab(tabId, knownTab = null) {
    if (tabId !== null) {
      scheduleTab(null);
    }
    const existing = jobs.get(tabId);
    if (existing) {
      existing.knownTab = knownTab;
      existing.pending = true;
      return existing.promise;
    }
    const job = { knownTab, pending: true, cancelled: false, promise: null };
    jobs.set(tabId, job);
    job.promise = runPendingWork(() => job.pending && !job.cancelled, async () => {
      job.pending = false;
      const version = revision;
      const { rules, activation, grantedOrigins } = await getState();
      const applicableRules = filterGrantedRules(rules, grantedOrigins);
      const tab = tabId === null ? null : job.knownTab || await getTab(tabId);
      if (job.cancelled) {
        return;
      }
      if (version !== revision || job.pending) {
        job.pending = true;
        return;
      }
      const badge = tabId !== null && !tab?.url
        ? { text: null, color: null }
        : resolveBadge(applicableRules, activation, { url: tab?.url });
      await paintBadge(badge, tabId, job);
      if (version !== revision) {
        job.pending = true;
      }
    }).catch(onError).finally(() => {
      if (jobs.get(tabId) === job) {
        jobs.delete(tabId);
      }
    });
    return job.promise;
  }

  function refresh() {
    revision++;
    refreshPending = true;
    for (const job of jobs.values()) {
      job.pending = true;
    }
    if (!refreshJob) {
      refreshJob = runPendingWork(() => refreshPending, async () => {
        refreshPending = false;
        scheduleTab(null);
        const version = navigationVersion;
        const tabs = await queryTabs({});
        for (const tab of tabs) {
          if ((navigations.get(tab.id) || 0) > version) {
            continue;
          }
          if (!tab.url && reconciled && (!painted.has(tab.id) || painted.get(tab.id).text === null)) {
            continue;
          }
          scheduleTab(tab.id, tab);
        }
        reconciled = true;
      }).catch(onError).finally(() => { refreshJob = null; });
    }
    return refreshJob;
  }

  function removeTab(tabId) {
    painted.delete(tabId);
    navigations.delete(tabId);
    const job = jobs.get(tabId);
    if (job) {
      job.cancelled = true;
      jobs.delete(tabId);
    }
  }

  function refreshTab(tabId, knownTab = null) {
    navigations.set(tabId, ++navigationVersion);
    return scheduleTab(tabId, knownTab);
  }

  function whenIdle() {
    return runPendingWork(
      () => refreshJob || jobs.size,
      () => Promise.all([refreshJob, ...Array.from(jobs.values(), (job) => job.promise)])
    );
  }

  return { refresh, refreshTab, removeTab, whenIdle };
}

/**
 * Counts enabled rules configured for a readable tab's exact destination host.
 * This does not observe requests, including cross-origin Fetch/XHR traffic.
 * Unreadable tabs show profile activation, not a site-specific rule count.
 */
export function resolveBadge(rules, activation, { url } = {}) {
  const scopedRules = scopeRules(rules, url);
  if (scopedRules === null) {
    return { text: '', color: null };
  }

  const liveCount = countLiveRules(scopedRules, activation);
  if (liveCount > 0) {
    return { text: url == null ? 'on' : String(liveCount), color: BADGE_ACTIVE_COLOR };
  }

  // Distinguish "nothing to apply" from "something is being held back", so the
  // paused state is visible but an empty profile stays quiet.
  const heldBackCount = countLiveRules(scopedRules, {
    masterEnabled: true,
    profileId: getTargetProfileId(activation)
  });

  return heldBackCount > 0
    ? { text: 'off', color: BADGE_PAUSED_COLOR }
    : { text: '', color: null };
}

/**
 * Returns the rules the badge should count, or `null` when the tab is a page
 * HeaderKit can never act on.
 */
function scopeRules(rules, url) {
  const allRules = Array.isArray(rules) ? rules : [];
  if (url === undefined || url === null) {
    return allRules;
  }

  const hostname = normalizeDomain(url);
  if (!hostname) {
    return null;
  }

  return allRules.filter((rule) => rule.domain === hostname);
}
