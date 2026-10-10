/**
 * Opens the same product-owned confirmation surface in the popup and manager.
 * The destructive action only runs after the dialog closes with "confirm".
 */
export function confirmDestructiveAction({
  title,
  message,
  confirmLabel = 'Delete'
}) {
  const dialog = document.getElementById('confirmationDialog');
  const confirmButton = document.getElementById('confirmationConfirmBtn');
  const cancelButton = document.getElementById('confirmationCancelBtn');

  document.getElementById('confirmationTitle').textContent = title;
  document.getElementById('confirmationMessage').textContent = message;
  confirmButton.textContent = confirmLabel;
  dialog.returnValue = '';

  return new Promise((resolve) => {
    const closeDialog = (returnValue) => {
      if (dialog.open) {
        dialog.close(returnValue);
      }
    };
    const handleConfirm = () => closeDialog('confirm');
    const handleCancel = () => closeDialog('cancel');
    const handleBackdropClick = (event) => {
      if (event.target === dialog) {
        closeDialog('cancel');
      }
    };
    const handleClose = () => {
      confirmButton.removeEventListener('click', handleConfirm);
      cancelButton.removeEventListener('click', handleCancel);
      dialog.removeEventListener('click', handleBackdropClick);
      resolve(dialog.returnValue === 'confirm');
    };

    confirmButton.addEventListener('click', handleConfirm);
    cancelButton.addEventListener('click', handleCancel);
    dialog.addEventListener('click', handleBackdropClick);
    dialog.addEventListener('close', handleClose, { once: true });
    dialog.showModal();
    cancelButton.focus();
  });
}
