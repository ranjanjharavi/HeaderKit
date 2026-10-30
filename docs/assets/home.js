const screenshots = {
  manager: {
    file: 'headerkit-rule-manager-screenshot.png',
    label: 'Rule manager',
    title: 'Every environment in one workspace.',
    copy: 'Switch profiles, review rules by hostname, and set when active rules stop.',
    alt: 'HeaderKit Rule Manager showing profiles, expiry controls, and request headers grouped by HTTPS host'
  },
  scope: {
    file: 'headerkit-request-scoping-screenshot.png',
    label: 'Request scope',
    title: 'A boundary for each rule.',
    copy: 'Choose an exact HTTPS host, an optional path prefix, and fetch/XHR matching.',
    alt: 'HeaderKit rule editor showing an exact HTTPS host, path prefix, and fetch/XHR matching'
  },
  profiles: {
    file: 'headerkit-manage-profiles-screenshot.png',
    label: 'Profiles',
    title: 'Separate setups. Clear starting states.',
    copy: 'Create, rename, or duplicate profiles. Copied rules begin paused.',
    alt: 'HeaderKit profile dialog explaining that copied rules start paused'
  },
  access: {
    file: 'headerkit-site-access-screenshot.png',
    label: 'Site access',
    title: 'Know which sites have access.',
    copy: 'Review and revoke site access without deleting saved rules.',
    alt: 'HeaderKit Site access dialog showing host permissions and revoke controls'
  },
  headers: {
    file: 'headerkit-headers-screenshot.png',
    label: 'Current host',
    title: 'The current host, at a glance.',
    copy: 'Review saved headers and see which rules are enabled or paused.',
    alt: 'HeaderKit popup showing staging headers and visible enabled and paused states'
  }
};
const image = document.getElementById('gallery-image');
const loading = document.getElementById('image-loading');
const status = document.getElementById('gallery-status');
const retryButton = document.getElementById('retry-screenshot');
const buttons = [...document.querySelectorAll('[data-shot]')];
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const still = new URLSearchParams(window.location.search).has('still');
let currentKey = 'manager';
let failedKey = null;
let requestVersion = 0;
let imageTransition;

function stopImageTransition() {
  if (!imageTransition) return;
  imageTransition.animation.cancel();
  imageTransition.overlay.remove();
  imageTransition = null;
}

function updateImage(source, alt) {
  stopImageTransition();
  const canFade = !motionPreference.matches && !still && typeof image.animate === 'function';
  const hasImage = image.complete && image.naturalWidth > 0;
  let overlay;
  if (canFade && hasImage && image.src !== source) {
    overlay = image.cloneNode(false);
    overlay.removeAttribute('id');
    overlay.alt = '';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.add('gallery-outgoing');
    image.after(overlay);
  }
  image.src = source;
  image.alt = alt;
  if (!overlay) return;
  const animation = overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 280,
    easing: 'cubic-bezier(.33, 1, .68, 1)',
    fill: 'forwards'
  });
  const transition = { animation, overlay };
  imageTransition = transition;
  const finish = () => {
    overlay.remove();
    animation.cancel();
    if (imageTransition === transition) imageTransition = null;
  };
  animation.finished.then(finish, finish);
}

motionPreference.addEventListener('change', (event) => {
  if (event.matches) stopImageTransition();
});

function finishLoading() {
  loading.hidden = true;
  retryButton.disabled = false;
  buttons.forEach((button) => button.removeAttribute('aria-busy'));
}

function showImageError(key) {
  failedKey = key;
  stopImageTransition();
  finishLoading();
  status.classList.add('is-error');
  status.textContent = 'Screenshot could not load. Check the connection or try again.';
  retryButton.hidden = false;
}

function showScreenshot(key) {
  if (!Object.hasOwn(screenshots, key)) return;
  const shot = screenshots[key];
  const version = ++requestVersion;
  const nextImage = new Image();
  const returnFocus = document.activeElement === retryButton;
  status.classList.remove('is-error');
  status.textContent = 'Loading ' + shot.label.toLowerCase() + ' screenshot…';
  retryButton.hidden = true;
  retryButton.disabled = true;
  loading.hidden = image.complete && image.naturalWidth > 0;
  buttons.forEach((button) => {
    button.setAttribute('aria-busy', String(button.dataset.shot === key));
  });

  nextImage.onload = () => {
    if (version !== requestVersion) return;
    updateImage(nextImage.src, shot.alt);
    currentKey = key;
    failedKey = null;
    document.getElementById('gallery-title').textContent = shot.title;
    document.getElementById('gallery-copy').textContent = shot.copy;
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.shot === key));
    });
    finishLoading();
    status.textContent = shot.label + ' screenshot loaded.';
    if (returnFocus) {
      const selectedButton = buttons.find((button) => button.dataset.shot === key);
      selectedButton.focus();
    }
  };

  nextImage.onerror = () => {
    if (version !== requestVersion) return;
    showImageError(key);
    if (returnFocus) retryButton.focus();
  };

  nextImage.src = 'assets/img/' + shot.file;
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-busy') === 'true') return;
    showScreenshot(button.dataset.shot);
  });
});

retryButton.addEventListener('click', () => showScreenshot(failedKey || currentKey));
image.addEventListener('error', () => showImageError(currentKey));
