// Р”РёР°РїР°Р·РѕРЅС‹/РїРѕРґР·Р°РґР°С‡Рё: unsorted / left / right / active / merge
(function () {
  const map = new Map(); // tag -> rect

  function layer() { return document.querySelector('#stage g.ranges') || VizState._S.svg.querySelector('g.ranges'); }

  function recompute() {
    const g = layer(); if (!g || !VizState._S.order.length) return;
    const xs = VizState.centersX(VizState._S.order);
    const rAt = (idx) => (VizState._S.order[idx] ? VizState._S.order[idx].r : VizCFG.R_MIN);

    map.forEach((rect, key) => {
      const l = +rect.dataset.l|0, r = +rect.dataset.r|0;
      const left  = xs[l] - rAt(l) - 6;
      const right = xs[r] + rAt(r) + 6;
      const w = Math.max(0, right - left);
      const top = VizCFG.CY - Math.max(rAt(l), rAt(r)) - 28;

      rect.setAttribute('x', left);
      rect.setAttribute('y', top);
      rect.setAttribute('width', w);
      rect.setAttribute('height', Math.max(24, VizCFG.R_MAX*2 + 20));
    });
  }

  function upsert(tag, l, r) {
    const g = layer(); if (!g) return;
    const key = String(tag || 'range');
    let rect = map.get(key);
    if (!rect) {
      rect = document.createElementNS(VizCFG.NS, 'rect');
      rect.setAttribute('class', 'range-rect');
      rect.setAttribute('opacity', '0.55');
      rect.dataset.tag = key;
      g.appendChild(rect);
      map.set(key, rect);
    }
    rect.dataset.l = String(Math.max(0, Math.min(l, VizState._S.order.length-1)));
    rect.dataset.r = String(Math.max(0, Math.min(r, VizState._S.order.length-1)));
    recompute();
  }

  function clearAll() {
    const g = layer();
    if (g) while (g.firstChild) g.removeChild(g.firstChild);
    map.clear();
  }

  function remove(tag) {
    const key = String(tag || 'range');
    const rect = map.get(key);
    if (!rect) return;
    rect.remove();
    map.delete(key);
  }

  window.VizRanges = { upsert, clearAll, remove, recompute, _map: map };
})();
