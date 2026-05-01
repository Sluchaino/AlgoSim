// quick.js - auto animation for quick sort
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const QuickSortState = {
    i: null,
    j: null,
    pivotValue: null,
    pivotIndex: -1,
    rangeL: null,
    rangeR: null,
    lastReadIndex: -1,
    lastReadValue: null,
    compareToken: 0,
    lastCompareOp: null,
    sortedMarked: false
  };

  function clearQuickSortedMarks() {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return;
    for (let i = 0; i < VizState._S.order.length; i++) {
      ctx.clearMarkAt(i, 'sorted');
    }
    QuickSortState.sortedMarked = false;
  }

  function canShowSortedMarks() {
    return !!(window.VizScene && typeof VizScene.canShowSortedMarks === 'function' && VizScene.canShowSortedMarks());
  }

  function isCurrentArraySorted() {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return false;
    const arr = VizState._S.order;
    if (arr.length <= 1) return true;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i - 1].value > arr[i].value) return false;
    }
    return true;
  }

  function updateQuickSortedMarks() {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return;
    if (!canShowSortedMarks()) return;
    const sortedNow = isCurrentArraySorted();
    if (!sortedNow) {
      if (QuickSortState.sortedMarked) clearQuickSortedMarks();
      return;
    }
    for (let i = 0; i < VizState._S.order.length; i++) {
      ctx.setMarkAt(i, 'sorted');
    }
    QuickSortState.sortedMarked = true;
  }

  function resetQuickSortState() {
    if (window.VizScene && typeof VizScene.setSortedMarksVisible === 'function') {
      VizScene.setSortedMarksVisible(false);
    }
    QuickSortState.i = null;
    QuickSortState.j = null;
    QuickSortState.pivotValue = null;
    QuickSortState.lastReadIndex = -1;
    QuickSortState.lastReadValue = null;
    if (QuickSortState.pivotIndex >= 0) {
      ctx.clearMarkAt(QuickSortState.pivotIndex, 'pivot');
    }
    QuickSortState.pivotIndex = -1;
    QuickSortState.rangeL = null;
    QuickSortState.rangeR = null;
    if (window.VizRanges && VizRanges.remove) {
      VizRanges.remove('partition');
    }
    clearQuickSortedMarks();
    ctx.clearPtr('i');
    ctx.clearPtr('j');
  }

  function setQuickPivotIndex(index) {
    if (!Number.isInteger(index) || index < 0) return;
    if (QuickSortState.pivotIndex === index) return;
    // Clear any stale pivot marks that could have moved with swaps
    if (ctx.handleGenericEvent) {
      ctx.handleGenericEvent({ kind: 'clearMarks', tag: 'pivot' });
    }
    if (QuickSortState.pivotIndex >= 0) {
      ctx.clearMarkAt(QuickSortState.pivotIndex, 'pivot');
    }
    QuickSortState.pivotIndex = index;
    ctx.setMarkAt(index, 'pivot');
  }

  function updateQuickPivotFromValue() {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    if (QuickSortState.pivotValue === null || QuickSortState.pivotValue === undefined) return;
    const l = Number.isInteger(QuickSortState.rangeL) ? QuickSortState.rangeL : 0;
    const r = Number.isInteger(QuickSortState.rangeR) ? QuickSortState.rangeR : (VizState._S.order.length - 1);
    let found = -1;
    for (let k = Math.max(0, l); k <= Math.min(r, VizState._S.order.length - 1); k++) {
      if (VizState._S.order[k].value === QuickSortState.pivotValue) { found = k; break; }
    }
    if (found >= 0) setQuickPivotIndex(found);
  }

  function updateQuickRange() {
    if (!window.VizRanges) return;
    if (!Number.isInteger(QuickSortState.rangeL) || !Number.isInteger(QuickSortState.rangeR)) return;
    VizRanges.upsert('partition', QuickSortState.rangeL, QuickSortState.rangeR);
  }

  function updateQuickRangeFromIndex(idx) {
    if (!Number.isInteger(idx) || idx < 0) return;
    if (!Number.isInteger(QuickSortState.rangeL) || idx < QuickSortState.rangeL) {
      QuickSortState.rangeL = idx;
    }
    if (!Number.isInteger(QuickSortState.rangeR) || idx > QuickSortState.rangeR) {
      QuickSortState.rangeR = idx;
    }
    updateQuickRange();
  }

  function resolvePointerMoveMs() {
    if (Number.isFinite(window.__algoDelayMs) && window.__algoDelayMs > 0) {
      return Math.max(50, Math.round(window.__algoDelayMs));
    }
    const moveDur = (window.VizDUR && Number.isFinite(VizDUR.move)) ? VizDUR.move : 0.35;
    return Math.max(50, Math.round(moveDur * 1000));
  }

  function resolveComparePulseMs() {
    if (window.VizHL && typeof VizHL.getPulseMs === 'function') {
      const ms = VizHL.getPulseMs('compare');
      if (Number.isFinite(ms) && ms > 0) return Math.max(50, Math.round(ms));
    }
    const pulseSec = (window.VizDUR && Number.isFinite(VizDUR.pulse)) ? VizDUR.pulse : 0.25;
    return Math.max(50, Math.round(pulseSec * 1000));
  }

  function resolveQuickReadMs() {
    // Start read immediately after pointer arrives, but keep duration from UI settings.
    if (window.VizHL && typeof VizHL.getPulseMs === 'function') {
      const ms = VizHL.getPulseMs('read');
      if (Number.isFinite(ms) && ms > 0) return Math.max(30, Math.round(ms));
    }
    return 80;
  }

  function scheduleCompare(pivotIdx, idx, moveMs) {
    if (!window.VizHL) return;
    QuickSortState.compareToken += 1;
    const token = QuickSortState.compareToken;
    const delayMs = Number.isFinite(moveMs) ? Math.max(0, Math.round(moveMs)) : resolvePointerMoveMs();
    const readMs = resolveQuickReadMs();
    const compareMs = resolveComparePulseMs();
    const settleMs = Math.max(20, Math.min(100, Math.round(delayMs * 0.1)));
    const hasPivot = Number.isInteger(pivotIdx) && pivotIdx >= 0;
    const sameAsPivot = hasPivot && pivotIdx === idx;

    const fireCompare = () => {
      if (QuickSortState.compareToken !== token) return;
      if (hasPivot && !sameAsPivot) {
        VizHL.pulseCompare(pivotIdx, idx);
      }
    };

    const fireReadThenCompare = () => {
      if (QuickSortState.compareToken !== token) return;
      VizHL.pulseRead(idx, readMs);
      if (readMs <= 0) {
        fireCompare();
        return;
      }
      if (window.gsap) {
        gsap.delayedCall(readMs / 1000, fireCompare);
      } else {
        setTimeout(fireCompare, readMs);
      }
    };

    if (delayMs <= 0) {
      fireReadThenCompare();
      return readMs + compareMs + settleMs;
    }

    if (window.gsap) {
      gsap.delayedCall(delayMs / 1000, fireReadThenCompare);
    } else {
      setTimeout(fireReadThenCompare, delayMs);
    }

    // Two-phase quick step timeline:
    // 1) pointer move, 2) short read pulse, 3) compare pulse, then tiny settle.
    return delayMs + readMs + compareMs + settleMs;
  }

  function handleQuickEvent(p) {
    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      ctx.setCurrentArray(p.value);
      resetQuickSortState();
      updateQuickSortedMarks();
      return;
    }

    if (p.kind === 'pivotAuto') {
      // New pivot means a new partition pass; reset visible partition window.
      QuickSortState.rangeL = null;
      QuickSortState.rangeR = null;
      if (window.VizRanges && VizRanges.remove) {
        VizRanges.remove('partition');
      }
      if (p.value !== null && p.value !== undefined) {
        QuickSortState.pivotValue = p.value;
      }
      if (Number.isInteger(p.index) && p.index >= 0) {
        setQuickPivotIndex(p.index);
        if (window.VizHL && typeof VizHL.pulseRead === 'function') {
          VizHL.pulseRead(p.index);
        }
      } else {
        updateQuickPivotFromValue();
      }
      const pulseMs = (window.VizDUR ? (VizDUR.pulse || 0.25) : 0.25) * 1000;
      return Math.round(pulseMs);
    }

    if (p.kind === 'compareEx') {
      const leftIsConst = p.i === -1;
      const rightIsConst = p.j === -1;
      const idx = leftIsConst ? p.j : (rightIsConst ? p.i : null);
      const constVal = leftIsConst ? p.ai : (rightIsConst ? p.bj : null);
      if (constVal !== null && constVal !== undefined && constVal !== QuickSortState.pivotValue) {
        QuickSortState.pivotValue = constVal;
        QuickSortState.rangeL = null;
        QuickSortState.rangeR = null;
        if (QuickSortState.pivotIndex >= 0) {
          ctx.clearMarkAt(QuickSortState.pivotIndex, 'pivot');
          QuickSortState.pivotIndex = -1;
        }
        if (Number.isInteger(QuickSortState.lastReadIndex) &&
            QuickSortState.lastReadIndex >= 0 &&
            QuickSortState.lastReadValue === constVal) {
          setQuickPivotIndex(QuickSortState.lastReadIndex);
        }
      }
      if (Number.isInteger(idx) && idx >= 0) {
        const pointerMoveMs = resolvePointerMoveMs();
        if (p.op === '<' || p.op === '<=') {
          QuickSortState.i = idx;
          QuickSortState.lastCompareOp = p.op;
          ctx.upsertPtr('i', idx, 'left', { durationMs: pointerMoveMs });
        } else if (p.op === '>' || p.op === '>=') {
          QuickSortState.j = idx;
          QuickSortState.lastCompareOp = p.op;
          ctx.upsertPtr('j', idx, 'right', { durationMs: pointerMoveMs });
        } else {
          QuickSortState.lastCompareOp = p.op || null;
        }
        updateQuickRangeFromIndex(idx);
        updateQuickPivotFromValue();
        const pivotIdx = QuickSortState.pivotIndex;
        return scheduleCompare(pivotIdx, idx, pointerMoveMs);
      }
      return;
    }

    if (p.kind === 'compare') {
      // For auto quick-sort with const pivot one side is often synthetic (-1):
      // keep compare visuals from compareEx to avoid duplicates.
      if (p.i === -1 || p.j === -1) return;
      ctx.handleGenericEvent(p);
      return;
    }

    if (p.kind === 'swap' && Number.isInteger(p.i) && Number.isInteger(p.j)) {
      if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
      ctx.animateSwap(p.i, p.j);
      updateQuickPivotFromValue();
      updateQuickSortedMarks();
      return;
    }

  if (p.kind === 'read' && window.VizHL && Number.isInteger(p.i)) {
    QuickSortState.lastReadIndex = p.i;
    QuickSortState.lastReadValue = ('value' in p) ? p.value : null;
    return;
  }

    ctx.handleGenericEvent(p);
  }

  function forceCompleteQuickSort() {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return false;
    if (!window.VizScene || typeof VizScene.revealSortedArray !== 'function') return false;
    if (!VizScene.isCurrentArraySorted || !VizScene.isCurrentArraySorted()) return false;

    if (QuickSortState.pivotIndex >= 0) {
      ctx.clearMarkAt(QuickSortState.pivotIndex, 'pivot');
      QuickSortState.pivotIndex = -1;
    }
    QuickSortState.pivotValue = null;
    QuickSortState.rangeL = null;
    QuickSortState.rangeR = null;
    QuickSortState.i = null;
    QuickSortState.j = null;
    QuickSortState.lastReadIndex = -1;
    QuickSortState.lastReadValue = null;
    QuickSortState.lastCompareOp = null;
    if (window.VizRanges && VizRanges.remove) {
      VizRanges.remove('partition');
    }
    clearQuickSortedMarks();
    ctx.clearPtr('i');
    ctx.clearPtr('j');

    if (window.VizScene && typeof VizScene.setSortedMarksVisible === 'function') {
      VizScene.setSortedMarksVisible(true);
    }
    const revealed = VizScene.revealSortedArray();
    QuickSortState.sortedMarked = revealed;
    return revealed;
  }

  window.VizScene.registerAuto('quick', {
    handle: handleQuickEvent,
    reset: resetQuickSortState
  });

  window.VizScene.registerControlled('quick', {
    handle: handleQuickEvent,
    reset: resetQuickSortState
  });

  window.VizScene.forceCompleteQuickSort = forceCompleteQuickSort;
})();
