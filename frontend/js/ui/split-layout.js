(function () {
  const layout = document.getElementById('split-layout');
  const resizer = document.getElementById('split-resizer');
  if (!layout || !resizer) return;

  const STORAGE_KEY = 'algosim.split.leftPanePercent.v7';
  const LEGACY_KEYS = [
    'algosim.split.leftPanePercent.v5',
    'algosim.split.leftPanePercent.v6'
  ];
  const MIN = 35;
  const MAX = 80;
  const DEFAULT = 60;

  function clamp(value) {
    return Math.min(MAX, Math.max(MIN, value));
  }

  function apply(percent, persist) {
    const next = clamp(percent);
    layout.style.setProperty('--left-pane', `${next}%`);
    resizer.setAttribute('aria-valuemin', String(MIN));
    resizer.setAttribute('aria-valuemax', String(MAX));
    resizer.setAttribute('aria-valuenow', String(Math.round(next)));
    if (persist) localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event('resize'));
  }

  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {}

  function percentFromClientX(clientX) {
    const rect = layout.getBoundingClientRect();
    if (!rect.width) return DEFAULT;
    return ((clientX - rect.left) / rect.width) * 100;
  }

  const saved = Number(localStorage.getItem(STORAGE_KEY));
  apply(Number.isFinite(saved) ? saved : DEFAULT, false);

  let dragging = false;
  let activePointerId = null;

  resizer.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 900px)').matches) return;
    dragging = true;
    activePointerId = event.pointerId;
    document.body.classList.add('is-resizing-split');
    resizer.setPointerCapture(event.pointerId);
    apply(percentFromClientX(event.clientX), true);
    event.preventDefault();
  });

  resizer.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    apply(percentFromClientX(event.clientX), true);
  });

  function stopDragging(event) {
    if (!dragging) return;
    if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    document.body.classList.remove('is-resizing-split');
  }

  resizer.addEventListener('pointerup', stopDragging);
  resizer.addEventListener('pointercancel', stopDragging);

  resizer.addEventListener('keydown', (event) => {
    const current = Number.parseFloat(getComputedStyle(layout).getPropertyValue('--left-pane')) || DEFAULT;
    if (event.key === 'ArrowLeft') {
      apply(current - 2, true);
      event.preventDefault();
    }
    if (event.key === 'ArrowRight') {
      apply(current + 2, true);
      event.preventDefault();
    }
    if (event.key === 'Home') {
      apply(MIN, true);
      event.preventDefault();
    }
    if (event.key === 'End') {
      apply(MAX, true);
      event.preventDefault();
    }
    if (event.key === 'Enter' || event.key === ' ') {
      apply(DEFAULT, true);
      event.preventDefault();
    }
  });

  window.addEventListener('resize', () => {
    const current = Number.parseFloat(getComputedStyle(layout).getPropertyValue('--left-pane')) || DEFAULT;
    layout.style.setProperty('--left-pane', `${clamp(current)}%`);
  });
})();
