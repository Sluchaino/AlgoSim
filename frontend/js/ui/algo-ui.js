// Algorithm tabs + UI mode switching
(function () {
  const tabs = Array.from(document.querySelectorAll('[data-algo]'));
  const arrayPanel = document.getElementById('array-panel');
  const graphPanel = document.getElementById('graph-panel');
  const theoryBlocks = Array.from(document.querySelectorAll('[data-theory]'));
  const binaryOnly = Array.from(document.querySelectorAll('[data-binary-only]'));
  const shuffleBtn = document.getElementById('shuffle');
  const playbackControls = document.getElementById('playback-controls');
  const playbackAnchorArray = document.getElementById('playback-controls-anchor-array');
  const playbackAnchorGraph = document.getElementById('playback-controls-anchor-graph');
  const modeInputs = Array.from(document.querySelectorAll('input[name="algo-mode"]'));
  const modeViews = Array.from(document.querySelectorAll('[data-mode-view]'));
  const modeBadge = document.getElementById('mode-badge');
  const modeStorageKey = 'algo-mode';
  const arrayAlgos = new Set(['insertion', 'selection', 'quick', 'binary']);
  const arrayState = new Map();
  const baseByAlgo = new Map();
  let baseArray = null;
  let currentAlgo = null;
  let currentMode = 'auto';

  function applyMode(mode) {
    currentMode = mode === 'controlled' ? 'controlled' : 'auto';
    modeInputs.forEach(input => {
      input.checked = input.value === currentMode;
    });
    modeViews.forEach(el => {
      el.classList.toggle('is-hidden', el.dataset.modeView !== currentMode);
    });
    if (modeBadge) {
      modeBadge.textContent = currentMode === 'controlled'
        ? 'Контроль: используйте ITracer/TracingExtensions и __STEP__'
        : 'Авто-анимация: TrackedList и обычные операции';
    }
    try { localStorage.setItem(modeStorageKey, currentMode); } catch {}
  }

  function initMode() {
    let saved = null;
    try { saved = localStorage.getItem(modeStorageKey); } catch {}
    applyMode(saved || 'auto');
  }

  function getAlgoKey() {
    const key = (location.hash || '').replace('#', '').trim().toLowerCase();
    return key || 'insertion';
  }

  function cloneArray(arr) {
    return Array.isArray(arr) ? arr.slice() : [];
  }

  function captureBaseArray() {
    if (baseArray !== null) return;
    if (window.getCurrentArray) baseArray = cloneArray(window.getCurrentArray());
    else baseArray = [];
  }

  function captureBaseForAlgo(algo) {
    if (!algo || baseByAlgo.has(algo)) return;
    if (window.getCurrentArray) baseByAlgo.set(algo, cloneArray(window.getCurrentArray()));
    else baseByAlgo.set(algo, []);
  }

  function saveArrayState(algo) {
    if (!arrayAlgos.has(algo) || !window.getCurrentArray) return;
    arrayState.set(algo, cloneArray(window.getCurrentArray()));
  }

  function restoreArrayState(algo) {
    if (!arrayAlgos.has(algo) || !window.setCurrentArray) return;
    if (arrayState.has(algo)) {
      window.setCurrentArray(cloneArray(arrayState.get(algo)));
    } else {
      window.setCurrentArray(cloneArray(baseByAlgo.get(algo) || baseArray || []));
    }
  }

  function applyAlgo(algo) {
    const isGraph = algo === 'bfs' || algo === 'dfs';
    const isBinary = algo === 'binary';

    captureBaseArray();
    if (currentAlgo && currentAlgo !== algo) {
      saveArrayState(currentAlgo);
    }

    tabs.forEach(t => {
      const active = t.dataset.algo === algo;
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });

    if (arrayPanel) arrayPanel.classList.toggle('is-hidden', isGraph);
    if (graphPanel) graphPanel.classList.toggle('is-hidden', !isGraph);
    theoryBlocks.forEach(b => b.classList.toggle('is-hidden', b.dataset.theory !== algo));

    binaryOnly.forEach(el => el.classList.toggle('is-hidden', !isBinary));

    if (shuffleBtn) {
      shuffleBtn.disabled = isBinary;
      shuffleBtn.title = isBinary ? 'Для бинарного поиска массив должен быть отсортирован' : '';
    }

    if (playbackControls) {
      const target = isGraph ? playbackAnchorGraph : playbackAnchorArray;
      if (target && playbackControls.parentNode !== target) {
        target.appendChild(playbackControls);
      }
    }

    if (!isGraph) restoreArrayState(algo);
    if (isBinary && window.ensureBinarySorted) window.ensureBinarySorted();
    captureBaseForAlgo(algo);

    currentAlgo = algo;
  }

  function resetArrayToBase() {
    const algo = currentAlgo || getAlgoKey();
    if (!arrayAlgos.has(algo) || !window.setCurrentArray) return;
    const base = cloneArray(baseByAlgo.get(algo) || baseArray || []);
    window.setCurrentArray(base);
    arrayState.set(algo, cloneArray(base));
    if (window.ensureBinarySorted) window.ensureBinarySorted();
  }

  window.getCurrentAlgo = getAlgoKey;
  window.getAlgoMode = () => currentMode;
  window.resetArrayToBase = resetArrayToBase;

  tabs.forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      const algo = t.dataset.algo;
      if (!algo) return;
      location.hash = '#' + algo;
    });
  });

  modeInputs.forEach(input => {
    input.addEventListener('change', () => applyMode(input.value));
  });

  window.addEventListener('hashchange', () => applyAlgo(getAlgoKey()));

  initMode();

  if (!location.hash) {
    location.hash = '#insertion';
  } else {
    applyAlgo(getAlgoKey());
  }

  applyAlgo(getAlgoKey());
})();

