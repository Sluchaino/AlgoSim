// selection.js - auto animation for selection sort
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const SelectionSortState = {
    outerIndex: -1,
    minIndex: -1,
    sortedEnd: -1,
    lastInnerJ: -1
  };

  function clearSelectionMarks() {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    VizState._S.order.forEach((_, idx) => {
      const node = VizState.nodeAtIndex(idx);
      if (!node) return;
      node.classList.remove('min');
      node.classList.remove('sorted');
    });
  }

  function resetSelectionSortState() {
    if (window.VizScene && typeof VizScene.setSortedMarksVisible === 'function') {
      VizScene.setSortedMarksVisible(false);
    }
    SelectionSortState.outerIndex = -1;
    SelectionSortState.minIndex = -1;
    SelectionSortState.sortedEnd = -1;
    SelectionSortState.lastInnerJ = -1;
    clearSelectionMarks();
  }

  function setSelectionMin(index) {
    if (!Number.isInteger(index) || index < 0) return;
    if (SelectionSortState.minIndex === index) return;
    if (SelectionSortState.minIndex >= 0) {
      ctx.clearMarkAt(SelectionSortState.minIndex, 'min');
    }
    SelectionSortState.minIndex = index;
    ctx.setMarkAt(index, 'min');
  }

  function updateSelectionSorted(endIndex) {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    const maxIdx = Math.max(-1, Math.min(endIndex, VizState._S.order.length - 1));
    VizState._S.order.forEach((_, idx) => {
      const node = VizState.nodeAtIndex(idx);
      if (!node) return;
      if (idx <= maxIdx) node.classList.add('sorted');
      else node.classList.remove('sorted');
    });
  }

  function beginSelectionPass(outerIndex) {
    if (!Number.isInteger(outerIndex) || outerIndex < 0) return;
    SelectionSortState.outerIndex = outerIndex;
    SelectionSortState.lastInnerJ = -1;
    SelectionSortState.sortedEnd = Math.max(SelectionSortState.sortedEnd, outerIndex - 1);
    updateSelectionSorted(SelectionSortState.sortedEnd);
    setSelectionMin(outerIndex);
  }

  function handleSelectionEvent(p) {
    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      ctx.setCurrentArray(p.value);
      resetSelectionSortState();
      return;
    }

    if (p.kind === 'compare') {
      return;
    }

    if (p.kind === 'compareEx') {
      const i = p.i;
      const j = p.j;
      if (Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0) {
        const pulseMs = (window.VizDUR ? (VizDUR.pulse || 0.25) : 0.25) * 1000;
        if (window.VizHL) VizHL.pulseCompare(i, j);

        const low = Math.min(i, j);
        const high = Math.max(i, j);
        if (SelectionSortState.outerIndex < 0) {
          beginSelectionPass(low);
        } else if (SelectionSortState.lastInnerJ >= 0 && high < SelectionSortState.lastInnerJ) {
          beginSelectionPass(Math.max(SelectionSortState.outerIndex + 1, low));
        } else if (low < SelectionSortState.outerIndex) {
          beginSelectionPass(low);
        }
        SelectionSortState.lastInnerJ = high;

        const ai = p.ai;
        const bj = p.bj;
        if (p.result === true) {
          if (p.op === '<' || p.op === '<=') setSelectionMin(i);
          else if (p.op === '>' || p.op === '>=') setSelectionMin(j);
        } else if (Number.isFinite(ai) && Number.isFinite(bj)) {
          if (ai < bj) setSelectionMin(i);
          else if (bj < ai) setSelectionMin(j);
        }
        return Math.round(pulseMs);
      }
      return;
    }

    // In selection-sort traces, move is an intermediate write hint before swap.
    // Applying it as real shift breaks order and causes duplicate/incorrect swap visuals.
    if (p.kind === 'move') {
      return;
    }

    if (p.kind === 'swap' && Number.isInteger(p.i) && Number.isInteger(p.j)) {
      if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
      ctx.animateSwap(p.i, p.j);
      if (SelectionSortState.outerIndex >= 0) {
        SelectionSortState.sortedEnd = Math.max(SelectionSortState.sortedEnd, SelectionSortState.outerIndex);
      } else {
        const sortedIndex = Math.min(p.i, p.j);
        SelectionSortState.sortedEnd = Math.max(SelectionSortState.sortedEnd, sortedIndex);
      }
      updateSelectionSorted(SelectionSortState.sortedEnd);
      if (SelectionSortState.minIndex >= 0) {
        ctx.clearMarkAt(SelectionSortState.minIndex, 'min');
        SelectionSortState.minIndex = -1;
      }
      SelectionSortState.lastInnerJ = Number.MAX_SAFE_INTEGER;
      return;
    }

    if (p.kind === 'read' && Number.isInteger(p.i)) {
      return ctx.handleGenericEvent(p);
    }

    ctx.handleGenericEvent(p);
  }

  function forceCompleteSelectionSort() {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return false;
    if (!window.VizScene || typeof VizScene.revealSortedArray !== 'function') return false;
    if (!VizScene.isCurrentArraySorted || !VizScene.isCurrentArraySorted()) return false;

    if (window.VizScene && typeof VizScene.setSortedMarksVisible === 'function') {
      VizScene.setSortedMarksVisible(true);
    }

    SelectionSortState.outerIndex = -1;
    SelectionSortState.lastInnerJ = -1;
    SelectionSortState.minIndex = -1;
    SelectionSortState.sortedEnd = VizState._S.order.length - 1;
    clearSelectionMarks();
    return VizScene.revealSortedArray();
  }

  window.VizScene.registerAuto('selection', {
    handle: handleSelectionEvent,
    reset: resetSelectionSortState
  });

  window.VizScene.forceCompleteSelectionSort = forceCompleteSelectionSort;
})();
