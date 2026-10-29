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
let currentKey = 'manager';
let failedKey = null;
let requestVersion = 0;

function finishLoading() {
  loading.hidden = true;
  retryButton.disabled = false;
  buttons.forEach((button) => button.removeAttribute('aria-busy'));
}

function showImageError(key) {
  failedKey = key;
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
  loading.hidden = false;
  buttons.forEach((button) => {
    button.setAttribute('aria-busy', String(button.dataset.shot === key));
  });

  nextImage.onload = () => {
    if (version !== requestVersion) return;
    image.src = nextImage.src;
    image.alt = shot.alt;
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

  nextImage.src = 'assets/' + shot.file;
}

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-busy') === 'true') return;
    showScreenshot(button.dataset.shot);
  });
});

retryButton.addEventListener('click', () => showScreenshot(failedKey || currentKey));
image.addEventListener('error', () => showImageError(currentKey));
