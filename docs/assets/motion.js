(() => {
  const root = document.documentElement;
  if (typeof window.matchMedia !== 'function') return;
  if (typeof window.IntersectionObserver !== 'function') return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const parameters = new URLSearchParams(window.location.search);
  if (preference.matches || parameters.has('still')) return;

  let observer;
  let enabled = true;

  function disableMotion() {
    enabled = false;
    root.classList.remove('motion-enabled', 'motion-entered');
    if (observer) observer.disconnect();
  }

  function reveal(element, immediate = false) {
    if (immediate) {
      element.style.setProperty('--motion-delay', '0ms');
      element.classList.add('motion-instant');
    }
    element.classList.add('is-revealed');
    if (observer) observer.unobserve(element);
  }

  function revealImage(element, immediate) {
    const image = element.querySelector('img');
    if (!image || image.complete) {
      reveal(element, immediate);
      return;
    }
    function resolveImage() {
      image.removeEventListener('load', resolveImage);
      image.removeEventListener('error', resolveImage);
      reveal(element, immediate);
    }
    image.addEventListener('load', resolveImage, { once: true });
    image.addEventListener('error', resolveImage, { once: true });
  }

  function revealGroup(group, immediate = false) {
    const elements = group.querySelectorAll('[data-motion]');
    elements.forEach((element) => {
      if (element.dataset.motion === 'image') {
        revealImage(element, immediate);
        return;
      }
      reveal(element, immediate);
    });
    observer.unobserve(group);
  }

  function finishIntro(event) {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
    const element = event.currentTarget;
    element.removeEventListener('transitionend', finishIntro);
    element.removeAttribute('data-motion');
    element.style.removeProperty('--motion-delay');
  }

  function onInteraction(event) {
    const group = event.target.closest('[data-motion-group]');
    if (group) revealGroup(group, true);
    const element = event.target.closest('[data-motion]');
    if (!element) return;
    reveal(element, true);
    if (element.dataset.motion === 'intro') {
      element.removeEventListener('transitionend', finishIntro);
      element.removeAttribute('data-motion');
    }
  }

  function initialize() {
    if (!enabled) return;
    try {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < .3) return;
          if (entry.target.hasAttribute('data-motion-group')) {
            revealGroup(entry.target);
            return;
          }
          reveal(entry.target);
        });
      }, { threshold: .3 });

      const intro = document.querySelectorAll('[data-motion="intro"]');
      intro.forEach((element, index) => {
        element.style.setProperty('--motion-delay', index * 60 + 'ms');
        element.addEventListener('transitionend', finishIntro);
      });

      document.querySelectorAll('[data-motion-group]').forEach((group) => {
        group.querySelectorAll('[data-motion]').forEach((element, index) => {
          element.style.setProperty('--motion-delay', index * 85 + 'ms');
        });
        observer.observe(group);
      });

      document.querySelectorAll('.guide-list').forEach((list) => {
        list.querySelectorAll('[data-motion="card"]').forEach((card, index) => {
          card.style.setProperty('--motion-delay', index * 85 + 'ms');
          observer.observe(card);
        });
      });

      document.addEventListener('focusin', onInteraction);
      document.addEventListener('pointerdown', onInteraction);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (enabled) root.classList.add('motion-entered');
        });
      });
    } catch {
      disableMotion();
    }
  }

  preference.addEventListener('change', (event) => {
    if (event.matches) disableMotion();
  });

  root.classList.add('motion-enabled');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
