// binary.js - controlled animation helpers for binary search
(function () {
  if (!window.VizScene || !window.VizSceneCtx) return;
  const ctx = window.VizSceneCtx;

  const BinaryState = {
    midIndex: -1,
    foundIndex: -1
  };

  function resetBinaryState() {
    if (BinaryState.midIndex >= 0) ctx.clearMarkAt(BinaryState.midIndex, 'mid');
    if (BinaryState.foundIndex >= 0) ctx.clearMarkAt(BinaryState.foundIndex, 'found');
    BinaryState.midIndex = -1;
    BinaryState.foundIndex = -1;
  }

  function setBinaryMid(index) {
    if (!Number.isInteger(index) || index < 0) return;
    if (BinaryState.midIndex === index) return;
    if (BinaryState.midIndex >= 0) ctx.clearMarkAt(BinaryState.midIndex, 'mid');
    BinaryState.midIndex = index;
    ctx.setMarkAt(index, 'mid');
  }

  function clearBinaryMid() {
    if (BinaryState.midIndex >= 0) ctx.clearMarkAt(BinaryState.midIndex, 'mid');
    BinaryState.midIndex = -1;
  }

  function setBinaryFound(index) {
    if (!Number.isInteger(index) || index < 0) return;
    if (BinaryState.foundIndex >= 0) ctx.clearMarkAt(BinaryState.foundIndex, 'found');
    BinaryState.foundIndex = index;
    ctx.setMarkAt(index, 'found');
    clearBinaryMid();
  }

  function handleBinaryControlled(p) {
    if (p.kind === 'mark' && p.tag === 'key') {
      setBinaryFound(p.i);
      return;
    }

    if (p.kind === 'notFound') {
      clearBinaryMid();
    }

    if (p.kind === 'ptr') {
      const isMid = (p.name === 'mid') || (p.tag === 'mid');
      if (isMid) setBinaryMid(p.index);
      return;
    }

    if (p.kind === 'ptrClear') {
      if (p.name === 'mid') clearBinaryMid();
      return;
    }

    ctx.handleGenericEvent(p);
  }

  window.VizScene.registerControlled('binary', {
    handle: handleBinaryControlled,
    reset: resetBinaryState
  });
})();
