export function showStatus(elementId, message, type) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.classList.remove('success', 'error');
  element.classList.add('visible', type);
  element.textContent = message;
  globalThis.clearTimeout(element._statusTimer);
  element._statusTimer = globalThis.setTimeout(() => {
    element.classList.remove('visible', 'success', 'error');
  }, 2800);
}

export function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
