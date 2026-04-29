// insertion.js - auto animation for insertion sort with lifted key and shifts
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const KEY_LIFT_Y = 46;
  const recentReads = [];

  const InsertionState = {
    active: false,
    keyId: null,
    keyValue: null,
    keyIndex: -1,
    keyOriginIndex: -1,
    compareIndex: -1,
    sortedEnd: 0,
    isPlaying: false
  };

  function moveMs() {
    return Math.round(((window.VizDUR && VizDUR.move) ? VizDUR.move : 0.35) * 1000);
  }

  function pulseMs() {
    return Math.round(((window.VizDUR && VizDUR.pulse) ? VizDUR.pulse : 0.25) * 1000);
  }

  function clearNodeClasses() {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    VizState._S.order.forEach((_, index) => {
      const node = VizState.nodeAtIndex(index);
      if (!node) return;
      node.classList.remove('key', 'compare', 'sorted');
    });
  }

  function setSortedPrefix(endIndex) {
    if (!window.VizState || !VizState._S || !VizState._S.order) return;
    VizState._S.order.forEach((_, index) => {
      const node = VizState.nodeAtIndex(index);
      if (!node) return;
      node.classList.remove('sorted');
      if (index <= endIndex && (!InsertionState.active || index !== InsertionState.keyIndex)) {
        node.classList.add('sorted');
      }
    });
  }

  function findIndexById(id) {
    if (!id || !window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return -1;
    for (let i = 0; i < VizState._S.order.length; i++) {
      if (VizState._S.order[i].id === id) return i;
    }
    return -1;
  }

  function layoutWithLift(durationMs) {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return;
    const S = VizState._S;
    const xs = VizState.centersX(S.order);
    const durationSec = Math.max(0, Number(durationMs || 0) / 1000);

    S.order.forEach((item, index) => {
      const node = S.nodesById.get(item.id);
      if (!node) return;
      const isKeyNode = InsertionState.active && item.id === InsertionState.keyId;
      const y = isKeyNode ? (VizCFG.CY - KEY_LIFT_Y) : VizCFG.CY;
      const x = xs[index];

      if (window.gsap) {
        if (durationSec > 0) {
          gsap.to(node, { x, y, duration: durationSec, ease: 'none', overwrite: 'auto' });
        } else {
          gsap.set(node, { x, y });
        }
      } else {
        node.style.transform = `translate(${x}px, ${y}px)`;
      }
    });

    if (window.VizRanges) VizRanges.recompute();
    ctx.refreshPtrs(durationSec);
  }

  function beginKey(compareIndex, keyValue) {
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return;
    if (!Number.isInteger(compareIndex)) return;

    let keyIndex = -1;
    for (let i = recentReads.length - 1; i >= 0; i--) {
      const rr = recentReads[i];
      if (!Number.isInteger(rr.index)) continue;
      if (rr.index <= compareIndex) continue;
      if (rr.value !== keyValue) continue;
      keyIndex = rr.index;
      break;
    }
    if (!Number.isInteger(keyIndex) || keyIndex < 0) {
      keyIndex = compareIndex + 1;
    }
    if (keyIndex < 0 || keyIndex >= VizState._S.order.length) return;

    const keyNode = VizState.nodeAtIndex(keyIndex);
    if (!keyNode) return;
    const item = VizState._S.order[keyIndex];
    if (!item) return;

    InsertionState.active = true;
    InsertionState.keyId = item.id;
    InsertionState.keyValue = keyValue;
    InsertionState.keyIndex = keyIndex;
    InsertionState.keyOriginIndex = keyIndex;
    InsertionState.compareIndex = compareIndex;

    keyNode.classList.add('key');
    layoutWithLift(moveMs());
  }

  function finishKeyInsertion() {
    if (!InsertionState.active) return;

    const keyId = InsertionState.keyId;
    if (keyId && window.VizState && VizState._S && VizState._S.nodesById) {
      const keyNode = VizState._S.nodesById.get(keyId);
      if (keyNode) keyNode.classList.remove('key');
    }

    InsertionState.active = false;
    InsertionState.compareIndex = -1;
    InsertionState.keyId = null;
    InsertionState.keyValue = null;
    InsertionState.keyIndex = -1;
    InsertionState.sortedEnd = Math.max(InsertionState.sortedEnd, InsertionState.keyOriginIndex);
    InsertionState.keyOriginIndex = -1;

    layoutWithLift(moveMs());
    setSortedPrefix(InsertionState.sortedEnd);
    _renderChips();
  }

  function resetInsertionSortState() {
    InsertionState.active = false;
    InsertionState.keyId = null;
    InsertionState.keyValue = null;
    InsertionState.keyIndex = -1;
    InsertionState.keyOriginIndex = -1;
    InsertionState.compareIndex = -1;
    InsertionState.sortedEnd = 0;
    recentReads.length = 0;

    if (window.VizHL) VizHL.clearAll();
    clearNodeClasses();
    setSortedPrefix(0);
    _renderChips();
  }

  function isInsertionCompareWithConst(p) {
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

  function constValueFromCompare(p) {
    if (Number.isInteger(p.i) && p.i >= 0 && p.j === -1) return p.bj;
    if (Number.isInteger(p.j) && p.j >= 0 && p.i === -1) return p.ai;
    return null;
  }

  function handleInsertionMove(p) {
    if (!InsertionState.active) return ctx.handleGenericEvent(p);
    if (!Number.isInteger(p.from) || !Number.isInteger(p.to)) return;
    if (!window.VizState || !VizState._S || !Array.isArray(VizState._S.order)) return;
    if (p.from < 0 || p.to < 0 || p.from >= VizState._S.order.length || p.to >= VizState._S.order.length) return;

    VizState.moveOrder(p.from, p.to);
    InsertionState.keyIndex = findIndexById(InsertionState.keyId);
    layoutWithLift(moveMs());
    _renderChips();
    return moveMs();
  }

  function handleInsertionSet(p) {
    if (!InsertionState.active) return ctx.handleGenericEvent(p);
    if (!Number.isInteger(p.i)) return;

    // Intermediate writes during shifts are ignored visually (nodes already moved).
    // Final insertion writes key into current gap index.
    if (p.i === InsertionState.keyIndex) {
      finishKeyInsertion();
      return moveMs();
    }
    return;
  }

  function handleInsertionCompare(p) {
    if (!isInsertionCompareWithConst(p)) return ctx.handleGenericEvent(p);

    const compareIndex = compareIndexFromConst(p);
    const keyValue = constValueFromCompare(p);

    // Safety for edge cases: if previous key is still active and we already moved
    // to the next iteration, close previous insertion first.
    if (InsertionState.active && Number.isInteger(compareIndex) && Number.isInteger(InsertionState.keyIndex)) {
      if (compareIndex >= InsertionState.keyIndex) {
        finishKeyInsertion();
      }
    }

    if (!InsertionState.active && Number.isInteger(compareIndex)) {
      beginKey(compareIndex, keyValue);
    }

    InsertionState.compareIndex = compareIndex;
    if (window.VizHL && Number.isInteger(compareIndex) && Number.isInteger(InsertionState.keyIndex)) {
      VizHL.pulseCompare(compareIndex, InsertionState.keyIndex);
    }

    _renderChips();
    return pulseMs();
  }

  function handleInsertionEvent(p) {
    if (!p || typeof p !== 'object') return;

    if (p.kind === 'setArray' && Array.isArray(p.value)) {
      ctx.setCurrentArray(p.value);
      resetInsertionSortState();
      return;
    }

    if (p.kind === 'read' && Number.isInteger(p.i)) {
      recentReads.push({ index: p.i, value: p.value });
      if (recentReads.length > 32) recentReads.shift();
      return ctx.handleGenericEvent(p);
    }

    if (p.kind === 'compareEx') {
      return handleInsertionCompare(p);
    }

    if (p.kind === 'move') {
      return handleInsertionMove(p);
    }

    if (p.kind === 'set') {
      return handleInsertionSet(p);
    }

    if (p.kind === 'swap' && Number.isInteger(p.i) && Number.isInteger(p.j)) {
      if (window.VizHL) VizHL.pulseSwap(p.i, p.j);
      ctx.animateSwap(p.i, p.j);
      return moveMs();
    }

    return ctx.handleGenericEvent(p);
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
      chip.textContent = String(v);
      if (InsertionState.active && idx === InsertionState.keyIndex) chip.classList.add('key');
      else if (InsertionState.active && idx === InsertionState.compareIndex) chip.classList.add('comparing');
      else if (idx <= InsertionState.sortedEnd) chip.classList.add('sorted');
      chip.title = `index: ${idx}, value: ${v}`;
      box.appendChild(chip);
    });
  }

  function forceCompleteAllInsertions() {
    if (InsertionState.active) {
      InsertionState.active = false;
      layoutWithLift(0);
    }
    if (window.VizState && VizState._S && Array.isArray(VizState._S.order)) {
      InsertionState.sortedEnd = Math.max(0, VizState._S.order.length - 1);
      setSortedPrefix(InsertionState.sortedEnd);
    }
    _renderChips();
  }

  window.VizScene.registerAuto('insertion', {
    handle: handleInsertionEvent,
    reset: resetInsertionSortState,
    renderChips: _renderChips,
    playback: (playing) => { InsertionState.isPlaying = playing; }
  });

  if (ctx.setRenderChips) ctx.setRenderChips(_renderChips);

  window.VizScene.resetInsertionSortState = resetInsertionSortState;
  window.VizScene.forceCompleteAllInsertions = forceCompleteAllInsertions;
})();
