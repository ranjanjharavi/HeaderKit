const RULE_FIELDS = ['domain', 'headerName', 'headerValue', 'pathPrefix', 'resourceType'];

function fieldId(field, ruleId) {
  return ruleId === null ? field : `edit${field[0].toUpperCase()}${field.slice(1)}-${ruleId}`;
}

function errorId(ruleId) {
  return ruleId === null ? 'ruleComposerError' : `ruleEditError-${ruleId}`;
}

export function clearRuleFormError(ruleId = null) {
  const error = document.getElementById(errorId(ruleId));
  error.textContent = '';
  error.hidden = true;
  RULE_FIELDS.forEach((field) => {
    document.getElementById(fieldId(field, ruleId)).removeAttribute('aria-invalid');
  });
}

export function showRuleFormError({ error: message, field }, ruleId = null) {
  clearRuleFormError(ruleId);
  const error = document.getElementById(errorId(ruleId));
  error.hidden = false;
  error.textContent = message;
  if (field) {
    const input = document.getElementById(fieldId(field, ruleId));
    const details = input.closest('details');
    if (details) {
      details.open = true;
    }
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}
