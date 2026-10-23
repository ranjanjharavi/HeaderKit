import { isSensitiveHeaderName, renderValueVisibilityIcon } from './rule-render.js';

export function syncHeaderValueField(form, { revealed = false } = {}) {
  const nameInput = form.querySelector('[data-header-name]');
  const valueInput = form.querySelector('[data-header-value]');
  const button = form.querySelector('[data-header-value-toggle]');
  if (!nameInput || !valueInput || !button) {
    return;
  }

  const sensitive = isSensitiveHeaderName(nameInput.value);
  const label = revealed ? 'Hide value' : 'Reveal value';
  valueInput.type = sensitive && !revealed ? 'password' : 'text';
  button.hidden = !sensitive;
  button.setAttribute('aria-pressed', String(sensitive && revealed));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = renderValueVisibilityIcon(revealed);
}

export function bindHeaderValueFields(container) {
  container.addEventListener('input', (event) => {
    if (event.target.matches('[data-header-name]')) {
      syncHeaderValueField(event.target.closest('form'));
    }
  });
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-header-value-toggle]');
    if (!button || button.disabled) {
      return;
    }
    const form = button.closest('form');
    const valueInput = form.querySelector('[data-header-value]');
    syncHeaderValueField(form, { revealed: valueInput.type === 'password' });
  });
}