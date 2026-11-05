import { getActivationStatus, getTargetProfileId } from '../../shared/domain/activation.js';
import { setMasterEnabled } from '../../shared/runtime/activation-api.js';
import { getProfileName } from '../../shared/domain/profiles.js';
import { state, getActivation } from '../state.js';
import { keepControlFocus, showStatus } from '../../shared/ui/ui.js';
import { getActivationDisplay } from '../view-model.js';

let onChanged;

export function bindActivationEvents(callbacks) {
  onChanged = callbacks.onChanged;
  document.getElementById('masterSwitch').addEventListener('click', () => toggleMaster());
  document.getElementById('resumeMasterBtn').addEventListener('click', resumeFromBanner);
}

async function toggleMaster(forceOn = false) {
  const nextEnabled = forceOn || getActivationStatus(getActivation()) !== 'live';

  await commitActivation(nextEnabled, nextEnabled ? 'Header rules resumed.' : 'All header rules paused.');
}

async function resumeFromBanner() {
  await toggleMaster(true);
}

async function commitActivation(enabled, message) {
  const masterSwitch = document.getElementById('masterSwitch');
  const controls = [masterSwitch, document.getElementById('resumeMasterBtn')];
  // The resume button hides once rules are live, so the switch takes over from it.
  const restoreFocus = keepControlFocus(masterSwitch);

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
    restoreFocus();
  }
}

export function renderMasterSwitch() {
  const activation = getActivation();
  const status = getActivationStatus(activation);
  const masterSwitch = document.getElementById('masterSwitch');

  // An expired timer leaves masterEnabled on with nothing applied, so show what is really happening.
  const isLive = status === 'live';
  masterSwitch.setAttribute('aria-checked', String(isLive));
  masterSwitch.setAttribute('aria-label', isLive ? 'Pause all header rules' : 'Resume all header rules');
  document.getElementById('masterSwitchLabel').textContent = isLive ? 'On' : 'Paused';

  const banner = document.getElementById('masterPausedBanner');
  // Hiding the focused resume button would drop focus, so hand it to the switch first.
  if (status === 'live' && banner.contains(document.activeElement)) {
    masterSwitch.focus();
  }
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
  const display = getActivationDisplay(state.headers.profiles, getActivation());
  document.getElementById('activeProfileName').textContent = display.profileName;
  document.getElementById('activeUntilLabel').textContent = display.appliedUntil;
}
