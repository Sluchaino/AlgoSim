// insertion.js - insertion sort auto animation with shift-overwrite semantics
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const recentReads = [];
  let keyBadgeEl = null;

  const State = {
    active: false,
    keyValue: null,
    keyOriginIndex: -1,
    compareIndex: -1,
    sortedEnd: -1,
    awaitingInsert: false,
    scaleMin: null,
    scaleMax: null,
    isPlaying: false
  };

  function moveMs() {
    return Math.round(((window.VizDUR && VizDUR.move) ? VizDUR.move : 0.35) * 1000);
  }

  function writeMs() {
    return Math.round(((window.VizDUR && VizDUR.set) ? VizDUR.set : 0.25) * 1000);
  }

  function pulseMs() {
    return Math.round(((window.VizDUR && VizDUR.pulse) ? VizDUR.pulse : 0.25) * 1000);
  }

  function ensureKeyBadge() {
    if (keyBadgeEl && keyBadgeEl.isConnected) return keyBadgeEl;
    const host = document.querySelector('#array-panel .svg-box');
    if (!host) return null;
    let el = host.querySelector('[data-insertion-key-badge]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'insertion-key-badge';
      el.setAttribute('data-insertion-key-badge', '1');
      host.appendChild(el);
    }
    keyBadgeEl = el;
    return keyBadgeEl;
  }

  function showKeyBadge(value) {
    const el = ensureKeyBadge();
    if (!el) return;
    const v = Number.isFinite(value) ? Math.trunc(value) : null;
    el.textContent = v === null ? 'Ключ' : `Ключ: ${v}`;
    el.classList.add('is-visible');
  }

  function hideKeyBadge() {
    const el = ensureKeyBadge();
    if (!el) return;
    el.classList.remove('is-visible');
  }

  function clearNodeClasses() {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    VizState._S.order.forEach((_, index) => {
      const node = VizState.nodeAtIndex(index);
      if (!node) return;
      node.classList.remove('compare', 'sorted', 'key');
    });
  }

  function canShowSortedMarks() {
    return !!(window.VizScene && typeof VizScene.canShowSortedMarks === 'function' && VizScene.canShowSortedMarks());
  }

  function initScaleFromArray(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      State.scaleMin = null;
      State.scaleMax = null;
      return;
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < arr.length; i++) {
      const v = Number.isFinite(arr[i]) ? arr[i] : 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      State.scaleMin = null;
      State.scaleMax = null;
      return;
    }
    State.scaleMin = min;
    State.scaleMax = max;
  }

  function radiusForValue(value) {
    const v = Number.isFinite(value) ? value : 0;
    const min = Number.isFinite(State.scaleMin) ? State.scaleMin : v;
    const max = Number.isFinite(State.scaleMax) ? State.scaleMax : v;
    const rMin = (window.VizCFG && Number.isFinite(VizCFG.R_MIN)) ? VizCFG.R_MIN : 14;
    const rMax = (window.VizCFG && Number.isFinite(VizCFG.R_MAX)) ? VizCFG.R_MAX : 54;
    const span = Math.max(1, max - min);
    const normalized = (v - min) / span;
    return rMin + normalized * (rMax - rMin);
  }

  function reflowByCurrentRadii(durationMs) {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return;
    const S = VizState._S;
    const gap = (window.VizCFG && Number.isFinite(VizCFG.GAP)) ? VizCFG.GAP : 14;
    const pad = (window.VizCFG && Number.isFinite(VizCFG.PAD)) ? VizCFG.PAD : 16;
    const widthContent = S.order.reduce((sum, it) => sum + (Number.isFinite(it.r) ? it.r * 2 : 0), 0) + gap * Math.max(0, S.order.length - 1);
    const width = Math.max(400, Math.ceil(pad * 2 + widthContent));
    if (typeof VizState.applyViewBoxWidth === 'function') VizState.applyViewBoxWidth(width);
    const sec = Math.max(0, Number(durationMs || 0) / 1000);
    VizState.layout(sec);
    ctx.refreshPtrs(sec);
  }

  function setSortedPrefix(endIndex) {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    const allowSorted = canShowSortedMarks();
    const maxIdx = Math.max(-1, Math.min(endIndex, VizState._S.order.length - 1));
    VizState._S.order.forEach((_, index) => {
      const node = VizState.nodeAtIndex(index);
      if (!node) return;
      node.classList.remove('sorted');
      if (allowSorted && index <= maxIdx) node.classList.add('sorted');
    });
  }

  function setNodeValue(index, value) {
    if (!Number.isInteger(index) || !window.VizState) return;
    const node = VizState.nodeAtIndex(index);
    const item = (window.VizState && VizState._S && Array.isArray(VizState._S.order))
      ? VizState._S.order[index]
      : null;
    const nextRadius = radiusForValue(value);
    VizState.updateValueAt(index, value);
    if (item && Number.isFinite(nextRadius)) item.r = nextRadius;
    if (node) {
      const circle = node.querySelector('circle');
      if (circle && Number.isFinite(nextRadius)) {
        circle.setAttribute('r', String(nextRadius));
      }
    }
    if (Array.isArray(window.currentArray) && index >= 0 && index < window.currentArray.length) {
      window.currentArray[index] = value;
    }
    reflowByCurrentRadii(writeMs());
  }

  function getNodeCenter(index) {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return null;
    if (!Number.isInteger(index) || index < 0 || index >= VizState._S.order.length) return null;
    const xs = VizState.centersX(VizState._S.order);
    if (!Array.isArray(xs) || !Number.isFinite(xs[index])) return null;
    return { x: xs[index], y: VizCFG.CY };
  }

  function animateShiftCopy(from, to, value) {
    const fromPos = getNodeCenter(from);
    const toPos = getNodeCenter(to);
    if (!fromPos || !toPos || !window.VizState || !VizState._S) return;

    const srcNode = VizState.nodeAtIndex(from);
    const srcCircle = srcNode ? srcNode.querySelector('circle') : null;
    const r = srcCircle ? Number(srcCircle.getAttribute('r')) : NaN;
    const radius = Number.isFinite(r) ? r : (window.VizCFG ? VizCFG.R_MIN : 12);

    const NS = window.VizCFG ? VizCFG.NS : 'http://www.w3.org/2000/svg';
    const ghost = document.createElementNS(NS, 'g');
    ghost.setAttribute('class', 'item shift-ghost');

    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(radius));
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '0');
    t.setAttribute('y', '0');
    t.textContent = String(Number.isFinite(value) ? Math.trunc(value) : '');

    ghost.appendChild(c);
    ghost.appendChild(t);

    const layer = document.querySelector('#stage g.items') || (VizState._S.svg || document.getElementById('stage'));
    if (!layer) return;
    layer.appendChild(ghost);

    const sec = Math.max(0, moveMs() / 1000);
    const removeGhost = () => {
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    };

    if (window.gsap) {
      gsap.set(ghost, { x: fromPos.x, y: fromPos.y });
      if (sec > 0) {
        gsap.to(ghost, { x: toPos.x, y: toPos.y, duration: sec, ease: 'none', overwrite: 'auto', onComplete: removeGhost });
      } else {
        gsap.set(ghost, { x: toPos.x, y: toPos.y });
        removeGhost();
      }
      return;
    }

    ghost.style.transform = `translate(${fromPos.x}px, ${fromPos.y}px)`;
    if (sec <= 0) {
      ghost.style.transform = `translate(${toPos.x}px, ${toPos.y}px)`;
      removeGhost();
      return;
    }
    setTimeout(() => {
      ghost.style.transform = `translate(${toPos.x}px, ${toPos.y}px)`;
      setTimeout(removeGhost, Math.round(sec * 1000));
    }, 0);
  }

  function isConstCompare(p) {
    if (!p || p.kind !== 'compareEx') return false;
    if (String(p.op || '').trim() !== '>') return false;
    const iNum = Number.isInteger(p.i) && p.i >= 0;
    const jNum = Number.isInteger(p.j) && p.j >= 0;
    return (iNum && p.j === -1) || (jNum && p.i === -1);
  }

  function compareIndexFromConst(p) {
    if (Number.isInteger(p.i) && p.i >= 0 && p.j === -1) return p.i;
    if (Number.isInteger(p.j) && p.j >= 0 && p.i === -1) return p.j;
    return -1;
  }

  function keyValueFromConst(p) {
    if (Number.isInteger(p.i) && p.i >= 0 && p.j === -1) return p.bj;
    if (Number.isInteger(p.j) && p.j >= 0 && p.i === -1) return p.ai;
    return null;
  }

  function detectKeyOrigin(compareIndex, keyValue) {
    let origin = compareIndex + 1;
    for (let i = recentReads.length - 1; i >= 0; i--) {
      const rr = recentReads[i];
      if (!Number.isInteger(rr.index)) continue;
      if (rr.index <= compareIndex) continue;
      if (rr.value !== keyValue) continue;
      origin = rr.index;
      break;
    }
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return origin;
    if (origin < 0 || origin >= VizState._S.order.length) return compareIndex + 1;
    return origin;
  }

  function beginKey(compareIndex, keyValue) {
    if (!Number.isFinite(keyValue)) return;
    State.active = true;
    State.keyValue = Math.trunc(keyValue);
    State.keyOriginIndex = detectKeyOrigin(compareIndex, State.keyValue);
    State.compareIndex = compareIndex;
    State.awaitingInsert = false;
    showKeyBadge(State.keyValue);
  }

  function finishKeyInsertion() {
    if (!State.active) return;
    State.active = false;
    State.awaitingInsert = false;
    State.compareIndex = -1;
    State.sortedEnd = Math.max(State.sortedEnd, State.keyOriginIndex);
    State.keyOriginIndex = -1;
    State.keyValue = null;
    hideKeyBadge();
    setSortedPrefix(State.sortedEnd);
    _renderChips();
  }

  function resetInsertionSortState() {
    if (window.VizScene && typeof VizScene.setSortedMarksVisible === 'function') {
      VizScene.setSortedMarksVisible(false);
    }
    State.active = false;
    State.keyValue = null;
    State.keyOriginIndex = -1;
    State.compareIndex = -1;
    State.sortedEnd = -1;
    State.awaitingInsert = false;
    State.scaleMin = null;
    State.scaleMax = null;
    recentReads.length = 0;

    hideKeyBadge();
    if (window.VizHL) VizHL.clearAll();
    clearNodeClasses();
    setSortedPrefix(0);
    _renderChips();
  }

  function handleCompareEx(p) {
    if (!isConstCompare(p)) return ctx.handleGenericEvent(p);

    const cmpIndex = compareIndexFromConst(p);
    const keyValue = keyValueFromConst(p);
    const result = p.result === true;

    if (!State.active && result && Number.isInteger(cmpIndex) && Number.isFinite(keyValue)) {
      beginKey(cmpIndex, keyValue);
    }

    if (State.active) {
      State.compareIndex = cmpIndex;
      if (result === false) State.awaitingInsert = true;
    } else if (Number.isInteger(cmpIndex)) {
      // Iteration without shifts still extends sorted prefix.
      State.sortedEnd = Math.max(State.sortedEnd, cmpIndex + 1);
      setSortedPrefix(State.sortedEnd);
    }

    if (window.VizHL && Number.isInteger(cmpIndex)) {
      const j = Number.isInteger(State.keyOriginIndex) && State.keyOriginIndex >= 0
        ? Math.min(State.keyOriginIndex, cmpIndex + 1)
        : cmpIndex + 1;
      VizHL.pulseCompare(cmpIndex, j);
    }

    _renderChips();
    return pulseMs();
  }

  function handleMove(p) {
    if (!Number.isInteger(p.from) || !Number.isInteger(p.to)) return;
    const value = Number.isFinite(p.value) ? Math.trunc(p.value) : NaN;
    animateShiftCopy(p.from, p.to, value);
    return moveMs();
  }

  function handleSet(p) {
    if (!Number.isInteger(p.i)) return;
    const value = Number.isFinite(p.value) ? Math.trunc(p.value) : 0;

    setNodeValue(p.i, value);
    if (window.VizHL && VizHL.pulseWrite) VizHL.pulseWrite(p.i);

    if (State.active) {
      const isFinalByValue = Number.isFinite(State.keyValue) && value === State.keyValue && p.i <= State.keyOriginIndex;
      const isFinalByAwait = State.awaitingInsert && p.i <= State.keyOriginIndex;
      if (isFinalByValue || isFinalByAwait) {
        finishKeyInsertion();
      }
    } else {
      State.sortedEnd = Math.max(State.sortedEnd, p.i);
      setSortedPrefix(State.sortedEnd);
    }

    _renderChips();
    return writeMs();
  }

  function handleInsertionEvent(p) {
    if (!p || typeof p !== 'object') return;

    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      initScaleFromArray(p.value);
      ctx.setCurrentArray(p.value);
      resetInsertionSortState();
      initScaleFromArray(p.value);
      return;
    }

    if (p.kind === 'read' && Number.isInteger(p.i)) {
      recentReads.push({ index: p.i, value: p.value });
      if (recentReads.length > 48) recentReads.shift();
      return ctx.handleGenericEvent(p);
    }

    if (p.kind === 'compareEx') return handleCompareEx(p);
    if (p.kind === 'move') return handleMove(p);
    if (p.kind === 'set') return handleSet(p);

    if (p.kind === 'swap') {
      // For insertion sort we intentionally avoid swap semantics in auto-animation.
      return;
    }

    return ctx.handleGenericEvent(p);
  }

  function _renderChips() {
    const box = document.getElementById('chips');
    if (!box) return;

    const arr = Array.isArray(window.currentArray)
      ? window.currentArray
      : (ctx.getCurrentArray ? ctx.getCurrentArray() : []);

    box.innerHTML = '';
    if (!arr.length) {
      box.textContent = '— пусто —';
      return;
    }

    arr.forEach((v, idx) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = String(v);
      if (State.active && idx === State.compareIndex) chip.classList.add('comparing');
      else if (canShowSortedMarks() && idx <= State.sortedEnd) chip.classList.add('sorted');
      chip.title = `index: ${idx}, value: ${v}`;
      box.appendChild(chip);
    });
  }

  function forceCompleteAllInsertions() {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return false;
    if (!window.VizScene || typeof VizScene.revealSortedArray !== 'function') return false;
    if (!VizScene.isCurrentArraySorted || !VizScene.isCurrentArraySorted()) return false;
    if (State.active) finishKeyInsertion();
    if (window.VizState && VizState._S && Array.isArray(VizState._S.order)) {
      State.sortedEnd = Math.max(-1, VizState._S.order.length - 1);
    }
    if (typeof VizScene.setSortedMarksVisible === 'function') {
      VizScene.setSortedMarksVisible(true);
    }
    return VizScene.revealSortedArray();
  }

  window.VizScene.registerAuto('insertion', {
    handle: handleInsertionEvent,
    reset: resetInsertionSortState,
    renderChips: _renderChips,
    playback: (playing) => { State.isPlaying = playing; }
  });

  if (ctx.setRenderChips) ctx.setRenderChips(_renderChips);
  window.VizScene.resetInsertionSortState = resetInsertionSortState;
  window.VizScene.forceCompleteAllInsertions = forceCompleteAllInsertions;
})();
