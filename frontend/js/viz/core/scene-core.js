// scene-core.js - shared visualization logic and registry
(function () {
  const autoHandlers = Object.create(null);
  const controlledHandlers = Object.create(null);
  const resetters = new Set();
  let renderChips = null;
  let playbackHook = null;
  let baseDelayMs = 0;
  let seekMode = false;
  let sortedMarksVisible = false;
  const DUR_BASE = window.__VizDUR_BASE || (window.VizDUR ? { ...VizDUR } : {
    pulse: 0.25,
    move: 0.35,
    swap: 0.40,
    set: 0.25,
    range: 0.20
  });
  if (!window.__VizDUR_BASE) window.__VizDUR_BASE = { ...DUR_BASE };

  const PtrState = {
    map: new Map()
  };

  function registerAuto(algo, handler) {
    if (!algo || !handler) return;
    autoHandlers[String(algo)] = handler;
    if (typeof handler.reset === 'function') resetters.add(handler.reset);
    if (typeof handler.renderChips === 'function') setRenderChips(handler.renderChips);
    if (typeof handler.playback === 'function') playbackHook = handler.playback;
  }

  function registerControlled(algo, handler) {
    if (!algo || !handler) return;
    controlledHandlers[String(algo)] = handler;
    if (typeof handler.reset === 'function') resetters.add(handler.reset);
  }

  function setRenderChips(fn) {
    renderChips = fn;
    if (window.VizScene) window.VizScene._renderChips = fn;
  }

  function canShowSortedMarks() {
    return sortedMarksVisible;
  }

  function setSortedMarksVisible(visible) {
    const next = !!visible;
    if (sortedMarksVisible === next) return sortedMarksVisible;
    sortedMarksVisible = next;
    if (!sortedMarksVisible) {
      clearMarks('sorted');
      callRenderChips();
    }
    return sortedMarksVisible;
  }

  function isCurrentArraySorted() {
    if (!VizState || !VizState._S || !Array.isArray(VizState._S.order)) return false;
    const arr = VizState._S.order;
    if (arr.length <= 1) return true;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i - 1].value > arr[i].value) return false;
    }
    return true;
  }

  function revealSortedArray() {
    if (!sortedMarksVisible) return false;
    if (!isCurrentArraySorted()) return false;
    clearMarks('sorted');
    if (VizState && VizState._S && Array.isArray(VizState._S.order)) {
      for (let i = 0; i < VizState._S.order.length; i++) {
        setMarkAt(i, 'sorted');
      }
    }
    callRenderChips();
    return true;
  }

  function callRenderChips() {
    if (typeof renderChips === 'function') renderChips();
  }

  function ptrLayer() {
    const NS = VizCFG.NS;
    let g = document.querySelector('#stage g.pointers');
    if (!g && VizState && VizState._S && VizState._S.svg) {
      g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'pointers');
      VizState._S.svg.appendChild(g);
    }
    return g;
  }

  function sanitizeTag(tag) {
    return String(tag || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  function ptrPosition(index) {
    if (!VizState || !VizState._S || !VizState._S.order.length) return null;
    if (!Number.isInteger(index) || index < 0 || index >= VizState._S.order.length) return null;
    const xs = VizState.centersX(VizState._S.order);
    const r = VizState._S.order[index].r || VizCFG.R_MIN;
    const x = xs[index];
    const y = VizCFG.CY - r - 18;
    return { x, y };
  }

  function upsertPtr(name, index, tag, options) {
    const key = String(name || 'ptr');
    const layer = ptrLayer();
    if (!layer) return;

    let entry = PtrState.map.get(key);
    if (!entry) {
      const g = document.createElementNS(VizCFG.NS, 'g');
      g.setAttribute('class', 'ptr');

      const tri = document.createElementNS(VizCFG.NS, 'polygon');
      tri.setAttribute('points', '0,0 -6,-10 6,-10');
      tri.setAttribute('class', 'ptr-triangle');

      const label = document.createElementNS(VizCFG.NS, 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', '-14');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'ptr-label');
      label.textContent = key;

      g.appendChild(tri);
      g.appendChild(label);
      layer.appendChild(g);

      entry = { g, index, tag };
      PtrState.map.set(key, entry);
    }

    entry.index = index;
    entry.tag = tag;

    const safeName = sanitizeTag(key);
    const safeTag = sanitizeTag(tag);
    const classes = ['ptr'];
    if (safeName) classes.push('ptr-name-' + safeName);
    if (safeTag) classes.push('ptr-' + safeTag);
    entry.g.className.baseVal = classes.join(' ');

    const pos = ptrPosition(index);
    if (!pos) return;

    if (window.gsap) {
      const opts = options && typeof options === 'object' ? options : null;
      const explicitMs = opts && Number.isFinite(opts.durationMs) ? Math.max(0, Math.round(opts.durationMs)) : null;
      const fallbackMs = getPointerDurationMs(key);
      const moveMs = explicitMs !== null ? explicitMs : fallbackMs;
      const moveDur = moveMs / 1000;
      if (seekMode || moveDur <= 0) {
        gsap.set(entry.g, { x: pos.x, y: pos.y });
      } else {
        gsap.to(entry.g, { x: pos.x, y: pos.y, duration: moveDur, ease: 'none', overwrite: 'auto' });
      }
    }
    else entry.g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }

  function clearPtr(name) {
    const key = String(name || 'ptr');
    const entry = PtrState.map.get(key);
    if (!entry) return;
    entry.g.remove();
    PtrState.map.delete(key);
  }

  function clearAllPtrs() {
    PtrState.map.forEach(entry => entry.g.remove());
    PtrState.map.clear();
  }

  function refreshPtrs(durationSec = 0) {
    const dur = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
    PtrState.map.forEach(entry => {
      const pos = ptrPosition(entry.index);
      if (!pos) return;
      if (window.gsap) {
        if (dur > 0 && !seekMode) {
          gsap.to(entry.g, { x: pos.x, y: pos.y, duration: dur, ease: 'none', overwrite: 'auto' });
        } else {
          gsap.set(entry.g, { x: pos.x, y: pos.y });
        }
      }
      else entry.g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    });
  }

  function clearMarkAt(index, cls) {
    const node = VizState && VizState.nodeAtIndex ? VizState.nodeAtIndex(index) : null;
    if (node) node.classList.remove(cls);
  }

  function setMarkAt(index, cls) {
    const node = VizState && VizState.nodeAtIndex ? VizState.nodeAtIndex(index) : null;
    if (node) node.classList.add(cls);
  }

  function initVisualization() {
    if (!Array.isArray(window.currentArray)) {
      window.currentArray = [12, 5, 8, 3, 15, 7];
    }
    setSortedMarksVisible(false);
    if (window.VizState) {
      VizState.build(window.currentArray);
    }
    resetAll();
    callRenderChips();
  }

  function setCurrentArray(arr) {
    const cleanArray = Array.isArray(arr) ? arr.map(val =>
      Number.isFinite(+val) ? Math.trunc(+val) : 0
    ) : [];

    window.currentArray = cleanArray;
    setSortedMarksVisible(false);

    if (window.VizState) {
      VizState.build(cleanArray);
    }

    resetAll();
    callRenderChips();
  }

  function resetAll() {
    setSortedMarksVisible(false);
    resetters.forEach(fn => {
      try { fn(ctx); } catch {}
    });
    clearAllPtrs();
    if (window.VizRanges) VizRanges.clearAll();
  }

  function getCurrentArray() {
    return Array.isArray(window.currentArray) ? window.currentArray.slice() : [];
  }

  function csArrayLiteral(arr) {
    const nums = (arr || []).map(x => Number.isFinite(+x) ? Math.trunc(+x) : 0);
    return `new[] { ${nums.join(', ')} }`;
  }

  function setHighlightDuration(ms) {
    if (window.VizHL) {
      VizHL.setPulseMs(ms);
    }
  }

  function setAnimationSpeed(speed) {
    const s = Number.isFinite(speed) ? Math.max(0.1, speed) : 1;
    if (window.VizDUR) {
      Object.keys(DUR_BASE).forEach(k => {
        if (Number.isFinite(DUR_BASE[k])) {
          VizDUR[k] = DUR_BASE[k] / s;
        }
      });
    }
  }

  function setBaseDelay(ms) {
    const n = Number.isFinite(ms) ? Math.floor(ms) : 0;
    baseDelayMs = Math.max(0, n);
  }

  function getPointerDurationMs(name) {
    if (Number.isFinite(window.__algoDelayMs) && window.__algoDelayMs > 0) {
      return Math.round(Math.min(12000, Math.max(50, window.__algoDelayMs)));
    }
    const moveMs = (window.VizDUR && Number.isFinite(VizDUR.move))
      ? Math.round(VizDUR.move * 1000)
      : 350;
    return Math.max(50, moveMs);
  }

  function getSwapDurationMs() {
    if (seekMode) return 0;
    if (Number.isFinite(baseDelayMs) && baseDelayMs > 0) {
      return Math.round(Math.min(12000, Math.max(50, baseDelayMs)));
    }
    const baseSec = (window.VizDUR && (VizDUR.swap || VizDUR.move)) ? (VizDUR.swap || VizDUR.move) : 0.35;
    const base = Math.round(baseSec * 1000);
    return Math.round(Math.min(12000, Math.max(50, base)));
  }

  function setPlaybackState(playing) {
    if (typeof playbackHook === 'function') playbackHook(playing);
  }

  function setSeekMode(enabled) {
    seekMode = !!enabled;
  }

  function clearMarks(tag) {
    const nodes = document.querySelectorAll('#stage .item');
    const cls = tag ? String(tag) : null;
    nodes.forEach(n => {
      if (!cls) {
        n.classList.remove('key', 'min', 'pivot', 'sorted', 'mid', 'found');
      } else if (['key', 'min', 'pivot', 'sorted', 'mid', 'found'].includes(cls)) {
        n.classList.remove(cls);
      }
    });
  }

  function handleGenericEvent(p) {
    if (!p || typeof p !== 'object') return;

    switch (p.kind) {
      case 'setArray':
        if (Array.isArray(p.value)) setCurrentArray(p.value);
        break;
      case 'compare':
      case 'compareEx':
        if (window.VizHL) VizHL.pulseCompare(p.i, p.j);
        break;
      case 'read':
        if (window.VizHL) VizHL.pulseRead(p.i);
        break;
      case 'swap':
        if (Number.isInteger(p.i) && Number.isInteger(p.j)) {
          if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
          animateSwap(p.i, p.j);
        }
        break;
      case 'move':
        if (Number.isInteger(p.from) && Number.isInteger(p.to)) {
          VizState.moveOrder(p.from, p.to);
          VizState.layout(VizDUR.move);
          refreshPtrs();
        }
        break;
      case 'set':
        if (tryAnimateSwapFromAfter(p.after)) return;
        if (Number.isInteger(p.i)) {
          if (window.VizHL && VizHL.pulseWrite) VizHL.pulseWrite(p.i);
          VizState.updateValueAt(p.i, p.value);
          VizState.relayoutWithRadii(VizDUR.set);
          refreshPtrs();
        }
        break;
      case 'mark':
        if (window.VizHL) {
          VizHL.markNode(p.i, p.tag);
        }
        break;
      case 'clearMarks':
        clearMarks(p.tag);
        break;
      case 'range':
        if (window.VizRanges) {
          const key = p.name || p.tag || 'range';
          VizRanges.upsert(key, p.l, p.r);
        }
        break;
      case 'rangeClear':
        if (window.VizRanges && VizRanges.remove) {
          const key = p.name || p.tag || 'range';
          VizRanges.remove(key);
        }
        break;
      case 'notFound':
        if (window.VizHL && typeof VizHL.pulseNotFound === 'function') {
          VizHL.pulseNotFound();
        }
        break;
      case 'clearRanges':
        if (window.VizRanges) VizRanges.clearAll();
        break;
      case 'ptr':
        {
          const ptrName = p.name || 'ptr';
          const ptrMs = getPointerDurationMs(ptrName);
          upsertPtr(ptrName, p.index, p.tag, { durationMs: ptrMs });
          break;
        }
      case 'ptrClear':
        clearPtr(p.name || 'ptr');
        break;
      default:
        break;
    }
  }

  function tryAnimateSwapFromAfter(afterArr) {
    if (!Array.isArray(afterArr) || !window.VizState || !VizState._S || !VizState._S.order) return false;
    const cur = VizState._S.order.map(x => x.value);
    if (afterArr.length !== cur.length) return false;
    const diff = [];
    for (let k = 0; k < cur.length; k++) {
      if (cur[k] !== afterArr[k]) diff.push(k);
      if (diff.length > 2) return false;
    }
    if (diff.length !== 2) return false;
    const i = diff[0], j = diff[1];
    if (cur[i] !== afterArr[j] || cur[j] !== afterArr[i]) return false;

    if (window.VizHL) VizHL.pulseSwap(i, j);
    animateSwap(i, j);
    return true;
  }

  function animateSwap(i, j) {
    if (!window.VizState) return;
    if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) return;

    const S = VizState._S;
    if (!S || !S.order || i < 0 || j < 0 || i >= S.order.length || j >= S.order.length) return;

    const before = VizState.centersX(S.order);
    const beforeById = new Map();
    S.order.forEach((it, idx) => beforeById.set(it.id, before[idx]));

    const idA = S.order[i].id;
    const idB = S.order[j].id;
    const nodeA = S.nodesById.get(idA);
    const nodeB = S.nodesById.get(idB);
    if (!nodeA || !nodeB) return;

    VizState.swapOrder(i, j);
    const after = VizState.centersX(S.order);

    const afterById = new Map();
    S.order.forEach((it, idx) => afterById.set(it.id, after[idx]));
    const swapMs = getSwapDurationMs();
    const total = swapMs / 1000;

    nodeA.classList.add('swap');
    nodeB.classList.add('swap');
    if (nodeA.parentNode) {
      nodeA.parentNode.appendChild(nodeA);
      nodeA.parentNode.appendChild(nodeB);
    }

    const clearSwapClass = () => {
      nodeA.classList.remove('swap');
      nodeB.classList.remove('swap');
    };

    if (seekMode) {
      S.order.forEach(it => {
        const node = S.nodesById.get(it.id);
        const targetX = afterById.get(it.id);
        if (!node || !Number.isFinite(targetX)) return;
        if (window.gsap) gsap.set(node, { x: targetX, y: VizCFG.CY });
        else node.style.transform = `translate(${targetX}px, ${VizCFG.CY}px)`;
      });
      if (window.VizScene) VizScene._lastSwapDurationMs = 0;
      clearSwapClass();
      if (window.VizRanges) VizRanges.recompute();
      refreshPtrs(0);
      return;
    }

    if (window.gsap) {
      if (window.VizScene) VizScene._lastSwapDurationMs = Math.round(swapMs);
      S.order.forEach(it => {
        const node = S.nodesById.get(it.id);
        if (!node) return;
        const startX = beforeById.get(it.id);
        const targetX = afterById.get(it.id);
        if (Number.isFinite(startX)) gsap.set(node, { x: startX, y: VizCFG.CY });
        if (Number.isFinite(targetX)) {
          gsap.to(node, { x: targetX, y: VizCFG.CY, duration: total, ease: 'none', overwrite: 'auto' });
        }
      });
      gsap.delayedCall(total, clearSwapClass);
    } else if (nodeA.animate && nodeB.animate) {
      const d = swapMs;
      if (window.VizScene) VizScene._lastSwapDurationMs = Math.round(d);
      S.order.forEach(it => {
        const node = S.nodesById.get(it.id);
        if (!node || !node.animate) return;
        const startX = beforeById.get(it.id);
        const targetX = afterById.get(it.id);
        if (!Number.isFinite(startX) || !Number.isFinite(targetX)) return;
        const key = [
          { transform: `translate(${startX}px, ${VizCFG.CY}px)` },
          { transform: `translate(${targetX}px, ${VizCFG.CY}px)` }
        ];
        node.animate(key, { duration: d, easing: 'linear', fill: 'forwards' });
      });
      setTimeout(clearSwapClass, d);
    } else {
      S.order.forEach(it => {
        const node = S.nodesById.get(it.id);
        const targetX = afterById.get(it.id);
        if (node && Number.isFinite(targetX)) {
          node.style.transform = `translate(${targetX}px, ${VizCFG.CY}px)`;
        }
      });
      clearSwapClass();
    }

    if (window.VizRanges) VizRanges.recompute();
    refreshPtrs(total);
  }

  function handleStepEvent(evt) {
    const p = (evt && evt.payload && evt.payload.kind) ? evt.payload : evt;
    if (!p || typeof p !== 'object') return;

    const algo = window.getCurrentAlgo ? window.getCurrentAlgo() : 'insertion';
    const mode = window.getAlgoMode ? window.getAlgoMode() : 'auto';

    if (mode === 'controlled') {
      const handler = controlledHandlers[algo];
      if (handler && typeof handler.handle === 'function') {
        return handler.handle(p, ctx);
      }
      return handleGenericEvent(p);
    }

    const handler = autoHandlers[algo];
    if (handler && typeof handler.handle === 'function') {
      return handler.handle(p, ctx);
    }

    return handleGenericEvent(p);
  }

  function handleStepLine(line) {
    const trimmed = (line || '').trim();
    if (trimmed.startsWith('{"ts"') || trimmed.includes('"type":"step"')) {
      try {
        const data = JSON.parse(trimmed);
        if (data.type === 'step' && data.payload) {
          handleStepEvent(data.payload);
        } else if (data.kind) {
          handleStepEvent(data);
        }
      } catch (e) {
        // ignore parse errors
      }
    }
  }

  const ctx = {
    getCurrentArray,
    setCurrentArray,
    csArrayLiteral,
    setHighlightDuration,
    setBaseDelay,
    setSortedMarksVisible,
    canShowSortedMarks,
    isCurrentArraySorted,
    revealSortedArray,
    getSwapDurationMs,
    setPlaybackHook: (fn) => { playbackHook = fn; },
    setRenderChips,
    callRenderChips,
    clearMarkAt,
    setMarkAt,
    upsertPtr,
    clearPtr,
    clearAllPtrs,
    refreshPtrs,
    handleGenericEvent,
    tryAnimateSwapFromAfter,
    animateSwap
  };

  window.VizScene = {
    registerAuto,
    registerControlled,
    handleStepEvent,
    handleStepLine,
    setCurrentArray,
    getCurrentArray,
    csArrayLiteral,
    setHighlightDuration,
    setBaseDelay,
    setAnimationSpeed,
    setPlaybackState,
    setSeekMode,
    setSortedMarksVisible,
    canShowSortedMarks,
    isCurrentArraySorted,
    revealSortedArray,
    getSwapDelayMs: () => {
      const last = window.VizScene ? window.VizScene._lastSwapDurationMs : 0;
      if (Number.isFinite(last) && last > 0) return last;
      return getSwapDurationMs();
    },
    initVisualization,
    _renderChips: renderChips
  };

  window.VizSceneCtx = ctx;
  window.setCurrentArray = setCurrentArray;
  window.getCurrentArray = getCurrentArray;
  window.csArrayLiteral = csArrayLiteral;
  window.setHighlightDuration = setHighlightDuration;
  window.handleStepEvent = handleStepEvent;
  window.handleStepLine = handleStepLine;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVisualization);
  } else {
    setTimeout(initVisualization, 100);
  }
})();
