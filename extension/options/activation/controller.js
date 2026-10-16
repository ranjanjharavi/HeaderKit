import {
  formatRemainingTime,
  getActivationStatus,
  getRemainingMs,
  getTargetProfileId
} from '../../shared/domain/activation.js';
import { setActivationDuration, setMasterEnabled } from '../../shared/runtime/activation-api.js';
import { getProfileName } from '../../shared/domain/profiles.js';

import { showStatus } from '../../shared/ui/ui.js';
import { state, getActivation } from '../state.js';

let onChanged;
let onResumeProfile;
const DURATION_OPTIONS = [3_600_000, 28_800_000];
let durationPending = false;

export function bindActivationEvents(callbacks) {
  onChanged = callbacks.onChanged;
  onResumeProfile = callbacks.onResumeProfile;
  document.getElementById('masterSwitch').addEventListener('click', () => toggleMaster());
  document.getElementById('resumeMasterBtn').addEventListener('click', resumeFromBanner);
  const durationPills = document.getElementById('durationPills');
  durationPills.addEventListener('click', handleDurationClick);
  durationPills.addEventListener('keydown', handleDurationKeydown);
}

async function toggleMaster(forceOn = false) {
  const activation = getActivation();
  const nextEnabled = forceOn || !activation.masterEnabled;
  const controls = [
    document.getElementById('masterSwitch'),
    document.getElementById('resumeMasterBtn')
  ];

  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    await setMasterEnabled(nextEnabled);
    await onChanged();
    showStatus(
      'headerStatus',
      nextEnabled ? 'Header rules resumed.' : 'All header rules paused.',
      'success'
    );
  } catch (error) {
    console.error(error);
    showStatus('headerStatus', error.message || 'Could not change the ReqKit switch.', 'error');
  } finally {
    controls.forEach((control) => {
      control.disabled = false;
    });
  }
}

export function renderMasterSwitch() {
  const activation = getActivation();
  const status = getActivationStatus(activation);
  const masterSwitch = document.getElementById('masterSwitch');

  masterSwitch.setAttribute('aria-checked', String(activation.masterEnabled));
  masterSwitch.setAttribute(
    'aria-label',
    activation.masterEnabled ? 'Pause all header rules' : 'Resume all header rules'
  );
  document.getElementById('masterSwitchLabel').textContent = activation.masterEnabled ? 'On' : 'Paused';

  const banner = document.getElementById('masterPausedBanner');
  banner.hidden = status === 'live';
  if (status !== 'live') {
    const parked = status === 'parked';
    document.getElementById('masterPausedTitle').textContent = parked
      ? 'No profile is active'
      : 'All header rules are paused';
    document.getElementById('masterPausedDetail').textContent = parked
      ? `Resume to switch back to ${getProfileName(state.profiles, getTargetProfileId(activation))}. Your rules remain saved and editable.`
      : 'No headers are being applied. Your rules stay saved and editable, with their own On or Paused settings.';
  }
}

/**
 * The banner covers two different stops: the master switch, and an elapsed
 * timer that parked the profile. Resuming has to undo whichever it is.
 */
async function resumeFromBanner() {
  const activation = getActivation();

  if (getActivationStatus(activation) === 'parked') {
    await onResumeProfile(getTargetProfileId(activation));
    return;
  }

  await toggleMaster(true);
}

export function renderDurationField() {
  const activation = getActivation();
  const selectedValue = getDurationValue(activation);
  const disabled = durationPending || getActivationStatus(activation) !== 'live';
  const chip = document.getElementById('expiryChip');
  const remainingMs = getRemainingMs(activation);

  document.querySelectorAll('[data-duration]').forEach((pill) => {
    const selected = pill.dataset.duration === selectedValue;
    pill.setAttribute('aria-checked', String(selected));
    pill.tabIndex = selected ? 0 : -1;
    pill.disabled = disabled;
  });

  chip.hidden = remainingMs === null;
  if (remainingMs !== null) {
    chip.textContent = formatRemainingTime(remainingMs);
    chip.title = `Pauses in ${formatRemainingTime(remainingMs)}`;
  }
}

function handleDurationClick(event) {
  const pill = event.target.closest('[data-duration]');
  if (!pill || pill.disabled || pill.getAttribute('aria-checked') === 'true') {
    return;
  }

  selectDuration(pill.dataset.duration);
}

function handleDurationKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return;
  }

  const pills = [...event.currentTarget.querySelectorAll('[data-duration]:not(:disabled)')];
  const currentIndex = pills.indexOf(event.target.closest('[data-duration]'));
  if (currentIndex < 0 || !pills.length) {
    return;
  }

  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? pills.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + pills.length) % pills.length;
  pills[nextIndex].focus();
  selectDuration(pills[nextIndex].dataset.duration);
}

function getDurationValue(activation) {
  if (activation.untilBrowserClose) {
    return 'session';
  }
  if (!activation.expiresAt) {
    return 'indefinite';
  }

  return DURATION_OPTIONS.includes(activation.durationMs)
    ? String(activation.durationMs)
    : 'indefinite';
}

async function selectDuration(value) {
  const options = value === 'session'
    ? { untilBrowserClose: true }
    : { durationMs: value === 'indefinite' ? null : Number(value) };

  durationPending = true;
  setDurationPillsDisabled(true);
  try {
    await setActivationDuration(options);
    await onChanged();
    showStatus('activeSetupStatus', describeDuration(value), 'success');
  } catch (error) {
    console.error(error);
    showStatus('activeSetupStatus', error.message || 'Could not set the timer.', 'error');
  } finally {
    durationPending = false;
    renderDurationField();
  }
}

function setDurationPillsDisabled(disabled) {
  document.querySelectorAll('[data-duration]').forEach((pill) => {
    pill.disabled = disabled;
  });
}

function describeDuration(value) {
  if (value === 'session') {
    return 'Rules will pause when Chrome closes.';
  }
  if (value === 'indefinite') {
    return 'Rules stay on until you turn them off.';
  }

  return `Rules will pause in ${formatRemainingTime(Number(value))}.`;
}
