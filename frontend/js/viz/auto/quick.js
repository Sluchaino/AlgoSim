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
    lastCompareOp: null
  };

  function resetQuickSortState() {
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

  function scheduleCompare(pivotIdx, idx) {
    if (!window.VizHL) return;
    QuickSortState.compareToken += 1;
    const token = QuickSortState.compareToken;
    const dur = (window.VizDUR && Number.isFinite(VizDUR.move)) ? VizDUR.move : 0.35;
    const delayMs = Math.max(0, Math.round(dur * 1000));
    const fire = () => {
      if (QuickSortState.compareToken !== token) return;
      if (Number.isInteger(pivotIdx) && pivotIdx >= 0) VizHL.pulseCompare(pivotIdx, idx);
      else VizHL.pulseCompare(idx, idx);
    };
    if (delayMs <= 0) {
      fire();
      return;
    }
    if (window.gsap) {
      gsap.delayedCall(delayMs / 1000, fire);
    } else {
      setTimeout(fire, delayMs);
    }
  }

  function handleQuickEvent(p) {
    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      ctx.setCurrentArray(p.value);
      resetQuickSortState();
      return;
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
        if (p.op === '<' || p.op === '<=') {
          QuickSortState.i = idx;
          QuickSortState.lastCompareOp = p.op;
          ctx.upsertPtr('i', idx, 'left');
        } else if (p.op === '>' || p.op === '>=') {
          QuickSortState.j = idx;
          QuickSortState.lastCompareOp = p.op;
          ctx.upsertPtr('j', idx, 'right');
        } else {
          QuickSortState.lastCompareOp = p.op || null;
        }
        updateQuickRangeFromIndex(idx);
        updateQuickPivotFromValue();
        const pivotIdx = QuickSortState.pivotIndex;
        scheduleCompare(pivotIdx, idx);
      }
      return;
    }

    if (p.kind === 'swap' && Number.isInteger(p.i) && Number.isInteger(p.j)) {
      if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
      ctx.animateSwap(p.i, p.j);
      updateQuickPivotFromValue();
      return;
    }

    if (p.kind === 'read' && window.VizHL && Number.isInteger(p.i)) {
      QuickSortState.lastReadIndex = p.i;
      QuickSortState.lastReadValue = ('value' in p) ? p.value : null;
      VizHL.pulseRead(p.i);
      return;
    }

    ctx.handleGenericEvent(p);
  }

  window.VizScene.registerAuto('quick', {
    handle: handleQuickEvent,
    reset: resetQuickSortState
  });
})();
