// selection.js - auto animation for selection sort
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const SelectionSortState = {
    outerIndex: -1,
    minIndex: -1,
    sortedEnd: -1
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
    SelectionSortState.outerIndex = -1;
    SelectionSortState.minIndex = -1;
    SelectionSortState.sortedEnd = -1;
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

  function handleSelectionEvent(p) {
    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      ctx.setCurrentArray(p.value);
      resetSelectionSortState();
      return;
    }

    if (p.kind === 'compareEx') {
      if (window.VizHL) VizHL.pulseCompare(p.i, p.j);
      const i = p.i;
      const j = p.j;
      if (Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0) {
        const minIdx = Math.min(i, j);
        if (SelectionSortState.outerIndex < 0) {
          SelectionSortState.outerIndex = minIdx;
          SelectionSortState.sortedEnd = minIdx - 1;
          updateSelectionSorted(SelectionSortState.sortedEnd);
          setSelectionMin(minIdx);
        } else if (minIdx > SelectionSortState.outerIndex) {
          SelectionSortState.sortedEnd = minIdx - 1;
          updateSelectionSorted(SelectionSortState.sortedEnd);
          SelectionSortState.outerIndex = minIdx;
          setSelectionMin(minIdx);
        }

        const ai = p.ai;
        const bj = p.bj;
        if (Number.isFinite(ai) && Number.isFinite(bj)) {
          if (ai < bj) setSelectionMin(i);
          else if (bj < ai) setSelectionMin(j);
        } else if (p.result === true) {
          if (p.op === '<' || p.op === '<=') setSelectionMin(i);
          else if (p.op === '>' || p.op === '>=') setSelectionMin(j);
        }
      }
      return;
    }

    if (p.kind === 'swap' && Number.isInteger(p.i) && Number.isInteger(p.j)) {
      if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
      ctx.animateSwap(p.i, p.j);
      const sortedIndex = Math.min(p.i, p.j);
      SelectionSortState.sortedEnd = Math.max(SelectionSortState.sortedEnd, sortedIndex);
      updateSelectionSorted(SelectionSortState.sortedEnd);
      if (SelectionSortState.minIndex >= 0) {
        ctx.clearMarkAt(SelectionSortState.minIndex, 'min');
        SelectionSortState.minIndex = -1;
      }
      return;
    }

    if (p.kind === 'read' && Number.isInteger(p.i)) {
      if (window.VizHL) VizHL.pulseRead(p.i);
      return;
    }

    ctx.handleGenericEvent(p);
  }

  window.VizScene.registerAuto('selection', {
    handle: handleSelectionEvent,
    reset: resetSelectionSortState
  });
})();
