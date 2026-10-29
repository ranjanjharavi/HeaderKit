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
const DURATION_OPTIONS = new Set([3_600_000, 28_800_000]);
let durationPending = false;

export function bindActivationEvents(callbacks) {
  onChanged = callbacks.onChanged;
  onResumeProfile = callbacks.onResumeProfile;
  document.getElementById('masterSwitch').addEventListener('click', () => toggleMaster());
  document.getElementById('resumeMasterBtn').addEventListener('click', resumeFromBanner);
  const durationPills = document.getElementById('durationPills');
  durationPills.addEventListener('change', handleDurationChange);
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
    showStatus('headerStatus', error.message || 'Could not change the HeaderKit switch.', 'error');
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
    pill.checked = pill.dataset.duration === selectedValue;
    pill.disabled = disabled;
  });

  chip.hidden = remainingMs === null;
  if (remainingMs !== null) {
    chip.textContent = formatRemainingTime(remainingMs);
    chip.title = `Pauses in ${formatRemainingTime(remainingMs)}`;
  }
}

async function handleDurationChange(event) {
  const pill = event.target.closest('[data-duration]');
  if (!pill || pill.disabled || !pill.checked) {
    return;
  }
  const wasFocused = document.activeElement === pill;
  await selectDuration(pill.dataset.duration);
  if (wasFocused && document.activeElement === document.body && !pill.disabled) {
    pill.focus();
  }
}

function getDurationValue(activation) {
  if (activation.untilBrowserClose) {
    return 'session';
  }
  if (!activation.expiresAt) {
    return 'indefinite';
  }

  return DURATION_OPTIONS.has(activation.durationMs)
    ? String(activation.durationMs)
    : 'indefinite';
}

async function selectDuration(value) {
  let options = { durationMs: null };
  if (value === 'session') {
    options = { untilBrowserClose: true };
  } else if (value !== 'indefinite') {
    options = { durationMs: Number(value) };
  }

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
