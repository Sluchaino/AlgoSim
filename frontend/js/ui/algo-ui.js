// Algorithm tabs + UI mode switching
(function () {
  const tabs = Array.from(document.querySelectorAll('[data-algo]'));
  const theoryPanel = document.getElementById('theory-panel');
  const arrayPanel = document.getElementById('array-panel');
  const graphPanel = document.getElementById('graph-panel');
  const sandboxPanel = document.getElementById('sandbox-panel');
  const executionPanel = document.querySelector('.execution-panel');
  const sandboxKindButtons = Array.from(document.querySelectorAll('[data-sandbox-kind]'));
  const sandboxTheoryBlocks = Array.from(document.querySelectorAll('[data-sandbox-theory-kind]'));
  const theoryBlocks = Array.from(document.querySelectorAll('[data-theory]'));
  const binaryOnly = Array.from(document.querySelectorAll('[data-binary-only]'));
  const shuffleBtn = document.getElementById('shuffle');
  const playbackControls = document.getElementById('playback-controls');
  const stepsPanel = document.getElementById('steps-panel');
  const playbackAnchorArray = document.getElementById('playback-controls-anchor-array');
  const playbackAnchorGraph = document.getElementById('playback-controls-anchor-graph');
  const modeInputs = Array.from(document.querySelectorAll('input[name="algo-mode"]'));
  const modeViews = Array.from(document.querySelectorAll('[data-mode-view]'));
  const modeBadge = document.getElementById('mode-badge');
  const modeStorageKey = 'algo-mode';
  const sandboxStorageKey = 'sandbox-kind';
  const arrayAlgos = new Set(['insertion', 'selection', 'quick', 'binary']);
  const arrayState = new Map();
  const baseByAlgo = new Map();
  let baseArray = null;
  let currentAlgo = null;
  let currentMode = 'auto';
  let sandboxKind = 'array';

  function normalizeSandboxKind(kind) {
    return kind === 'graph' ? 'graph' : 'array';
  }

  function renderSandboxKind() {
    sandboxKindButtons.forEach(button => {
      const active = normalizeSandboxKind(button.dataset.sandboxKind) === sandboxKind;
      button.classList.toggle('primary', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    sandboxTheoryBlocks.forEach(block => {
      block.classList.toggle('is-hidden', normalizeSandboxKind(block.dataset.sandboxTheoryKind) !== sandboxKind);
    });
  }

  function setSandboxKind(kind, persist = true) {
    sandboxKind = normalizeSandboxKind(kind);
    if (persist) {
      try { localStorage.setItem(sandboxStorageKey, sandboxKind); } catch {}
    }
    renderSandboxKind();
  }

  function applyMode(mode) {
    currentMode = mode === 'controlled' ? 'controlled' : 'auto';
    modeInputs.forEach(input => {
      input.checked = input.value === currentMode;
    });
    modeViews.forEach(el => {
      el.classList.toggle('is-hidden', el.dataset.modeView !== currentMode);
    });
    if (modeBadge) {
      modeBadge.textContent = 'Шаблон алгоритма';
    }
    try { localStorage.setItem(modeStorageKey, currentMode); } catch {}
    updateLegendForAlgo(getAlgoKey());
  }

  function initMode() {
    if (!modeInputs.length) {
      applyMode('auto');
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(modeStorageKey); } catch {}
    applyMode(saved || 'auto');
  }

  function initSandboxKind() {
    let saved = null;
    try { saved = localStorage.getItem(sandboxStorageKey); } catch {}
    setSandboxKind(saved || 'array', false);
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
    const isSandbox = algo === 'sandbox';
    const isGraph = algo === 'bfs' || algo === 'dfs';
    const isBinary = algo === 'binary';
    const sandboxGraph = isSandbox && sandboxKind === 'graph';
    const sandboxArray = isSandbox && !sandboxGraph;
    const showArrayPanel = !isGraph && (!isSandbox || sandboxArray);
    const showGraphPanel = isGraph || sandboxGraph;
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
    if (theoryPanel) theoryPanel.classList.toggle('is-hidden', isSandbox);
    if (sandboxPanel) sandboxPanel.classList.toggle('is-hidden', !isSandbox);
    if (arrayPanel) arrayPanel.classList.toggle('is-hidden', !showArrayPanel);
    if (graphPanel) graphPanel.classList.toggle('is-hidden', !showGraphPanel);
    if (executionPanel) executionPanel.classList.remove('is-hidden');
    theoryBlocks.forEach(b => b.classList.toggle('is-hidden', b.dataset.theory !== algo));
    binaryOnly.forEach(el => el.classList.toggle('is-hidden', !isBinary || isSandbox));
    if (shuffleBtn) {
      shuffleBtn.disabled = isBinary || sandboxGraph;
      shuffleBtn.title = isBinary
        ? 'Для бинарного поиска массив должен быть отсортирован'
        : (sandboxGraph ? 'Для графа перемешивание массива не нужно' : '');
    }
    if (playbackControls) {
      playbackControls.classList.remove('is-hidden');
      if (stepsPanel) stepsPanel.classList.remove('is-hidden');
      const useGraphPane = isSandbox ? sandboxGraph : isGraph;
      const target = useGraphPane ? playbackAnchorGraph : playbackAnchorArray;
      if (target && playbackControls.parentNode !== target) {
        target.appendChild(playbackControls);
      }
      if (target && stepsPanel && stepsPanel.parentNode !== target) {
        target.appendChild(stepsPanel);
      }
    }
    updateLegendForAlgo(algo);
    if (!isGraph && !isSandbox) restoreArrayState(algo);
    if (isBinary && !isSandbox && window.ensureBinarySorted) window.ensureBinarySorted();
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
  window.getSandboxKind = () => sandboxKind;
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

  document.querySelectorAll('[data-sandbox-template]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.sandboxTemplate;
      const kind = normalizeSandboxKind(button.dataset.sandboxKind || (String(key).includes('graph') ? 'graph' : 'array'));
      setSandboxKind(kind);
      if (window.applyEditorTemplateKey && key) {
        window.applyEditorTemplateKey(key);
      }
      if (getAlgoKey() === 'sandbox') {
        applyAlgo('sandbox');
      }
    });
  });

  window.addEventListener('hashchange', () => applyAlgo(getAlgoKey()));

  initMode();
  initSandboxKind();

  if (!location.hash) {
    location.hash = '#insertion';
  } else {
    applyAlgo(getAlgoKey());
  }

  applyAlgo(getAlgoKey());

  function updateLegendForAlgo(algo) {
    const isSandbox = algo === 'sandbox';
    const isGraph = isSandbox ? sandboxKind === 'graph' : (algo === 'bfs' || algo === 'dfs');
    const mode = currentMode;
    const arrayLegend = document.querySelector('[data-legend-scope="array"]');
    const graphLegend = document.querySelector('[data-legend-scope="graph"]');

    const cfg = window.LEGEND_CONFIG || { auto: {}, controlled: {}, graph: {} };

    function syncLegendItems(legendRoot, keys) {
      if (!legendRoot) return;
      const items = Array.from(legendRoot.querySelectorAll('[data-legend-item]'));
      const itemByKey = new Map(items.map(el => [el.dataset.legendItem, el]));
      const ordered = [];
      const seen = new Set();
      (Array.isArray(keys) ? keys : []).forEach(key => {
        const item = itemByKey.get(key);
        if (!item || seen.has(key)) return;
        seen.add(key);
        ordered.push(item);
      });
      items.forEach(el => {
        const key = el.dataset.legendItem;
        el.classList.toggle('is-hidden', !seen.has(key));
      });
      const itemsHost = legendRoot.querySelector('.legend-items');
      if (itemsHost) {
        ordered.forEach(el => itemsHost.appendChild(el));
      }
    }

    if (arrayLegend) {
      const keys = isSandbox
        ? ((cfg.sandbox || {}).array || [])
        : ((mode === 'controlled' ? cfg.controlled : cfg.auto)[algo] || []);
      syncLegendItems(arrayLegend, isGraph ? [] : keys);
    }

    if (graphLegend) {
      const keys = isSandbox
        ? ((cfg.sandbox || {}).graph || [])
        : ((cfg.graph || {})[algo] || []);
      syncLegendItems(graphLegend, isGraph ? keys : []);
    }
  }
})();
