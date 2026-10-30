import { MAX_BACKUP_BYTES, parseBackup } from '../../shared/domain/backup.js';
import { exportBackup, importBackup } from '../../shared/runtime/backup-api.js';

let refreshAll = async () => {};
let selectedText = null;
let busy = false;

export function bindBackupEvents({ onChanged }) {
  refreshAll = onChanged;
  const dialog = document.getElementById('backupDialog');
  document.getElementById('backupBtn').addEventListener('click', () => {
    if (dialog.open) {
      return;
    }
    clearSelection();
    setStatus('');
    setStatus('', '', 'backupExportStatus');
    dialog.showModal();
  });
  document.getElementById('closeBackupBtn').addEventListener('click', closeDialog);
  document.getElementById('doneBackupBtn').addEventListener('click', closeDialog);
  document.getElementById('exportBackupBtn').addEventListener('click', downloadBackup);
  document.getElementById('backupFile').addEventListener('change', readBackupFile);
  document.getElementById('backupImportForm').addEventListener('submit', submitImport);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy) {
      event.preventDefault();
    }
  });
  dialog.addEventListener('close', () => {
    // A queued close event may arrive after the dialog has reopened.
    if (!dialog.open) {
      clearSelection();
    }
  });
}

function closeDialog() {
  if (!busy) {
    document.getElementById('backupDialog').close();
  }
}

async function downloadBackup() {
  if (busy) {
    return;
  }
  setBusy('export');
  setStatus('Preparing backup…', '', 'backupExportStatus');
  try {
    const text = await exportBackup();
    const blob = new Blob([text], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    try {
      link.href = url;
      link.download = `headerkit-backup-${new Date().toISOString().replaceAll(':', '-')}.json`;
      document.body.append(link);
      link.click();
    } finally {
      link.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    setStatus('Backup download started. The file contains unencrypted header values.', 'success', 'backupExportStatus');
  } catch (error) {
    setStatus(error.message || 'Could not export a backup. Try again.', 'error', 'backupExportStatus');
  } finally {
    setBusy(null);
    focusBackupResult('exportBackupBtn', 'backupExportStatus');
  }
}

async function readBackupFile(event) {
  if (busy) {
    return;
  }
  const input = event.currentTarget;
  const file = input.files?.[0];
  clearSelection({ clearFile: false });
  setStatus('');
  if (!file) {
    return;
  }
  setBusy('read');
  setStatus('Checking backup…');
  document.getElementById('backupStatus').scrollIntoView({ block: 'nearest' });
  let resultId = null;
  try {
    if (file.size > MAX_BACKUP_BYTES) {
      throw new Error('Backups must be 5 MiB or smaller. Choose a smaller HeaderKit backup.');
    }
    const text = await file.text();
    if (!isCurrentBackupFile(file)) {
      return;
    }
    const backup = parseBackup(text);
    selectedText = text;
    const preview = document.getElementById('backupPreview');
    preview.textContent = `${describeCounts(backup.profiles.length, backup.rules.length)} ready to import. All imported rules will be paused.`;
    preview.hidden = false;
    setStatus('');
    resultId = 'importBackupBtn';
  } catch (error) {
    if (isCurrentBackupFile(file)) {
      input.value = '';
      input.setAttribute('aria-invalid', 'true');
      setStatus(error.message || 'Could not read this file. Choose a HeaderKit JSON backup.', 'error');
      resultId = 'backupStatus';
    }
  } finally {
    setBusy(null);
    if (resultId) {
      focusBackupResult('backupFile', resultId);
    }
  }
}

function isCurrentBackupFile(file) {
  const input = document.getElementById('backupFile');
  return document.getElementById('backupDialog').open && input.files?.[0] === file;
}

async function submitImport(event) {
  event.preventDefault();
  if (busy || selectedText === null) {
    return;
  }
  setBusy('import');
  setStatus('Importing profiles…');
  document.getElementById('backupStatus').scrollIntoView({ block: 'nearest' });
  let imported = false;
  try {
    const result = await importBackup(selectedText);
    imported = true;
    clearSelection();
    let message = `Imported ${describeCounts(result.profileCount, result.ruleCount)}. Imported rules are paused. Select a profile to review them.`;
    try {
      await refreshAll();
    } catch {
      message += ' Reload the rule manager to see the saved profiles.';
    }
    setStatus(message, 'success');
  } catch (error) {
    setStatus(error.message || 'Could not import this backup. Existing data was kept. Try again.', 'error');
  } finally {
    setBusy(null);
    const focusId = imported ? 'doneBackupBtn' : 'importBackupBtn';
    focusBackupResult(focusId, 'backupStatus');
  }
}

function focusBackupResult(controlId, resultId) {
  if (!document.getElementById('backupDialog').open) {
    return;
  }
  document.getElementById(controlId).focus({ preventScroll: true });
  document.getElementById(resultId).scrollIntoView({ block: 'nearest' });
}

function clearSelection({ clearFile = true } = {}) {
  selectedText = null;
  const input = document.getElementById('backupFile');
  if (clearFile) {
    input.value = '';
  }
  input.removeAttribute('aria-invalid');
  const preview = document.getElementById('backupPreview');
  preview.hidden = true;
  preview.textContent = '';
  document.getElementById('importBackupBtn').disabled = true;
}

function setBusy(operation) {
  busy = operation !== null;
  document.getElementById('backupDialog').setAttribute('aria-busy', String(busy));
  for (const id of ['exportBackupBtn', 'backupFile', 'closeBackupBtn', 'doneBackupBtn']) {
    document.getElementById(id).disabled = busy;
  }
  const importButton = document.getElementById('importBackupBtn');
  importButton.disabled = busy || selectedText === null;
  importButton.textContent = operation === 'import' ? 'Importing…' : 'Import profiles';
  document.getElementById('exportBackupBtn').textContent =
    operation === 'export' ? 'Preparing backup…' : 'Download JSON backup';
}

function setStatus(message, type = '', elementId = 'backupStatus') {
  const status = document.getElementById(elementId);
  status.textContent = message;
  status.classList.toggle('is-error', type === 'error');
  status.classList.toggle('is-success', type === 'success');
}

function describeCounts(profiles, rules) {
  const profileLabel = profiles === 1 ? 'profile' : 'profiles';
  const ruleLabel = rules === 1 ? 'rule' : 'rules';
  return `${profiles} ${profileLabel} and ${rules} ${ruleLabel}`;
}
