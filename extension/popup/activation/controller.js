import { getActivationStatus, getTargetProfileId } from '../../shared/domain/activation.js';
import { setMasterEnabled } from '../../shared/runtime/activation-api.js';
import { getProfileName } from '../../shared/domain/profiles.js';
import { state, getActivation } from '../state.js';
import { showStatus } from '../../shared/ui/ui.js';
import { getActivationDisplay } from '../view-model.js';

let onChanged;

export function bindActivationEvents(callbacks) {
  onChanged = callbacks.onChanged;
  document.getElementById('masterSwitch').addEventListener('click', () => toggleMaster());
  document.getElementById('resumeMasterBtn').addEventListener('click', resumeFromBanner);
}

async function toggleMaster(forceOn = false) {
  const activation = getActivation();
  const nextEnabled = forceOn || !activation.masterEnabled;

  await commitActivation(
    nextEnabled,
    nextEnabled ? 'Header rules resumed.' : 'All header rules paused.'
  );
}

async function resumeFromBanner() {
  await toggleMaster(true);
}

async function commitActivation(enabled, message) {
  const controls = [
    document.getElementById('masterSwitch'),
    document.getElementById('resumeMasterBtn')
  ];

  controls.forEach((control) => {
    control.disabled = true;
  });

  try {
    await setMasterEnabled(enabled);
    await onChanged();
    showStatus('headerStatus', message, 'success');
  } catch (error) {
    console.error(error);
    renderMasterSwitch();
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
      ? `Resume to switch back to ${getProfileName(state.headers.profiles, getTargetProfileId(activation))}. Your rules remain saved and editable.`
      : 'No headers are being applied. Your rules stay saved and editable, with their own On or Paused settings.';
  }
}

export function renderActivationSummary() {
  const display = getActivationDisplay(
    state.headers.profiles,
    getActivation()
  );
  document.getElementById('activeProfileName').textContent = display.profileName;
  document.getElementById('activeUntilLabel').textContent = display.appliedUntil;
}
