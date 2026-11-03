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

/**
 * Disabling or hiding a focused control drops focus after about a frame, and re-enabling it doesn't bring focus back.
 * A control that stays hidden hands focus to the fallback.
 */
export function keepControlFocus(fallback = null) {
  const focused = document.activeElement;
  if (!focused || focused === document.body) {
    return () => {};
  }
  return () => {
    // Leave it if something else has taken focus, such as an error field.
    // Chrome can keep reporting a hidden control as active until it clears focus, so check for that too.
    if (document.activeElement !== document.body && document.activeElement !== focused) {
      return;
    }
    if (focused.checkVisibility()) {
      focused.focus();
    } else {
      fallback?.focus();
    }
  };
}

export function getNextTabIndex(key, currentIndex, tabCount) {
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return tabCount - 1;
    case 'ArrowLeft':
      return (currentIndex - 1 + tabCount) % tabCount;
    case 'ArrowRight':
      return (currentIndex + 1) % tabCount;
    default:
      return currentIndex;
  }
}

export function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
