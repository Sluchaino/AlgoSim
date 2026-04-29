// insertion.js - auto animation for insertion sort
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const InsertionSortState = {
    keyIndex: -1,
    sortedEndIndex: 0,
    isPlaying: false,
    keyNode: null,
    isKeyActive: false,
    keyValue: null,
    currentCompareIndex: -1
  };

  function resetInsertionSortState() {
    if (window.VizState && VizState._S && VizState._S.order) {
      VizState._S.order.forEach((_, index) => {
        const node = VizState.nodeAtIndex(index);
        if (node) {
          node.classList.remove('key');
          node.classList.remove('compare');
        }
      });
    }

    InsertionSortState.keyIndex = -1;
    InsertionSortState.sortedEndIndex = 0;
    InsertionSortState.keyNode = null;
    InsertionSortState.isKeyActive = false;
    InsertionSortState.keyValue = null;
    InsertionSortState.currentCompareIndex = -1;

    if (window.VizHL) {
      VizHL.clearAll();
    }

    updateSortedVisualization();
  }

  function visualizeTakeKey(keyIndex) {
    if (keyIndex < 1 || keyIndex >= ctx.getCurrentArray().length) return;

    if (InsertionSortState.isKeyActive) {
      resetKeyVisualization();
    }

    InsertionSortState.keyIndex = keyIndex;
    InsertionSortState.isKeyActive = true;
    InsertionSortState.keyValue = ctx.getCurrentArray()[keyIndex];
    InsertionSortState.keyNode = VizState.nodeAtIndex(keyIndex);

    if (InsertionSortState.keyNode) {
      InsertionSortState.keyNode.classList.add('key');
    }

    if (InsertionSortState.keyNode && window.gsap) {
      gsap.to(InsertionSortState.keyNode, {
        y: -40,
        scale: 1.1,
        duration: VizDUR.move,
        ease: 'power2.out'
      });
    }

    _renderChips();
  }

  function resetKeyVisualization() {
    if (InsertionSortState.keyNode) {
      InsertionSortState.keyNode.classList.remove('key');
      if (window.gsap) {
        gsap.to(InsertionSortState.keyNode, {
          y: 0,
          scale: 1,
          duration: VizDUR.move,
          ease: 'power2.in'
        });
      }
    }
  }

  function visualizeCompare(compareIndex) {
    if (compareIndex < 0 || !InsertionSortState.isKeyActive) return;

    if (InsertionSortState.currentCompareIndex !== -1) {
      const prevNode = VizState.nodeAtIndex(InsertionSortState.currentCompareIndex);
      if (prevNode) {
        prevNode.classList.remove('compare');
      }
    }

    InsertionSortState.currentCompareIndex = compareIndex;
    const compareNode = VizState.nodeAtIndex(compareIndex);
    if (compareNode) {
      compareNode.classList.add('compare');
      if (window.gsap) {
        gsap.delayedCall(VizDUR.pulse, () => {
          if (compareNode.classList.contains('compare')) {
            compareNode.classList.remove('compare');
          }
        });
      }
    }

    _renderChips();
  }

  function visualizeShift(fromIndex, toIndex) {
    if (fromIndex < 0 || toIndex < 0) return;

    const arr = ctx.getCurrentArray();
    const [movedItem] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, movedItem);
    window.currentArray = arr;

    VizState.moveOrder(fromIndex, toIndex);
    VizState.layout(VizDUR.move);
    ctx.refreshPtrs();

    _renderChips();
  }

  function completeKeyInsertion() {
    if (!InsertionSortState.isKeyActive) return;

    if (InsertionSortState.currentCompareIndex !== -1) {
      const compareNode = VizState.nodeAtIndex(InsertionSortState.currentCompareIndex);
      if (compareNode) {
        compareNode.classList.remove('compare');
      }
      InsertionSortState.currentCompareIndex = -1;
    }

    if (InsertionSortState.keyNode && window.gsap) {
      gsap.to(InsertionSortState.keyNode, {
        y: 0,
        scale: 1,
        duration: VizDUR.move,
        ease: 'back.out(1.7)',
        onComplete: () => {
          finalizeKeyInsertion();
        }
      });
    } else {
      finalizeKeyInsertion();
    }
  }

  function finalizeKeyInsertion() {
    InsertionSortState.sortedEndIndex = Math.max(InsertionSortState.sortedEndIndex, InsertionSortState.keyIndex);
    updateSortedVisualization();

    resetKeyVisualization();
    InsertionSortState.keyIndex = -1;
    InsertionSortState.isKeyActive = false;
    InsertionSortState.keyValue = null;
    InsertionSortState.keyNode = null;

    _renderChips();
  }

  function updateSortedVisualization() {
    if (!window.VizHL || !window.VizState) return;

    VizState._S.order.forEach((_, index) => {
      const node = VizState.nodeAtIndex(index);
      if (node) {
        node.classList.remove('sorted');
      }
    });

    for (let i = 0; i <= InsertionSortState.sortedEndIndex; i++) {
      if (!InsertionSortState.isKeyActive || i !== InsertionSortState.keyIndex) {
        VizHL.markNode(i, 'sorted');
      }
    }
  }

  function updateInsertionSortedFromCompare(i, j) {
    if (!Number.isInteger(i) || !Number.isInteger(j)) return;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    if (hi === lo + 1 && hi - 1 > InsertionSortState.sortedEndIndex) {
      InsertionSortState.sortedEndIndex = hi - 1;
      updateSortedVisualization();
      _renderChips();
    }
  }

  function finalizeInsertionIfSorted() {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    const arr = VizState._S.order;
    if (!arr.length) return;
    for (let k = 1; k < arr.length; k++) {
      if (arr[k - 1].value > arr[k].value) return;
    }
    InsertionSortState.sortedEndIndex = arr.length - 1;
    updateSortedVisualization();
    _renderChips();
  }

  function handleInsertionEvent(p) {
    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      ctx.setCurrentArray(p.value);
      resetInsertionSortState();
      return;
    }

    if (p.kind === 'compare') {
      return;
    }

    if (p.kind === 'compareEx') {
      const i = p.i;
      const j = p.j;
      if (Number.isInteger(i) && Number.isInteger(j)) {
        const pulseMs = (window.VizDUR ? (VizDUR.pulse || 0.25) : 0.25) * 1000;
        if (window.VizHL) VizHL.pulseCompare(i, j);
        updateInsertionSortedFromCompare(i, j);
        return Math.round(pulseMs);
      }
      updateInsertionSortedFromCompare(p.i, p.j);
      return;
    }

    if (p.kind === 'read') {
      return ctx.handleGenericEvent(p);
    }

    if (p.kind === 'swap' && Number.isInteger(p.i) && Number.isInteger(p.j)) {
      if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
      ctx.animateSwap(p.i, p.j);
      finalizeInsertionIfSorted();
      return;
    }

    ctx.handleGenericEvent(p);
  }

  function _renderChips() {
    const box = document.getElementById('chips');
    if (!box) return;

    const arr = ctx.getCurrentArray();
    box.innerHTML = '';

    if (!arr.length) {
      box.textContent = '— пусто —';
      return;
    }

    arr.forEach((v, idx) => {
      const chip = document.createElement('span');
      chip.className = 'chip';

      if (InsertionSortState.isKeyActive && idx === InsertionSortState.keyIndex) {
        chip.classList.add('key');
        chip.textContent = '🔑' + v;
      } else if (InsertionSortState.isKeyActive && idx === InsertionSortState.currentCompareIndex) {
        chip.classList.add('comparing');
        chip.textContent = String(v);
      } else if (idx <= InsertionSortState.sortedEndIndex) {
        chip.classList.add('sorted');
        chip.textContent = String(v);
      } else {
        chip.textContent = String(v);
      }

      chip.title = `index: ${idx}, value: ${v}`;
      box.appendChild(chip);
    });
  }

  function forceCompleteAllInsertions() {
    if (InsertionSortState.isKeyActive) {
      completeKeyInsertion();
    }
    InsertionSortState.sortedEndIndex = ctx.getCurrentArray().length - 1;
    updateSortedVisualization();
    _renderChips();
  }

  window.VizScene.registerAuto('insertion', {
    handle: handleInsertionEvent,
    reset: resetInsertionSortState,
    renderChips: _renderChips,
    playback: (playing) => { InsertionSortState.isPlaying = playing; }
  });

  if (ctx.setRenderChips) ctx.setRenderChips(_renderChips);

  window.VizScene.resetInsertionSortState = resetInsertionSortState;
  window.VizScene.forceCompleteAllInsertions = forceCompleteAllInsertions;
})();
