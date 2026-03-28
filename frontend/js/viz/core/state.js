// РЎРѕСЃС‚РѕСЏРЅРёРµ СЃС†РµРЅС‹: СѓР·Р»С‹, РїРѕСЃС‚СЂРѕРµРЅРёРµ, СЂР°СЃРєР»Р°РґРєР°, РѕР±РЅРѕРІР»РµРЅРёРµ Р·РЅР°С‡РµРЅРёР№
(function () {
  const S = {
    svg: document.getElementById('stage'),
    order: [],              // [{ id, value, r }]
    nodesById: new Map(),   // id -> <g.item>
  };

  function uid() {
    return 'n_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  }

  function clearSVG() {
    if (!S.svg) return;
    while (S.svg.firstChild) S.svg.removeChild(S.svg.firstChild);
    S.nodesById.clear();
    S.order.length = 0;
  }

  function ensureDefs() {
    const NS = VizCFG.NS;
    let defs = S.svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(NS, 'defs');
      S.svg.insertBefore(defs, S.svg.firstChild || null);
    }
    if (!S.svg.querySelector('#rangeGrad')) {
      const grad = document.createElementNS(NS, 'linearGradient');
      grad.setAttribute('id', 'rangeGrad');
      grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
      grad.setAttribute('x2', '0%'); grad.setAttribute('y2', '100%');
      const s1 = document.createElementNS(NS, 'stop');
      const s2 = document.createElementNS(NS, 'stop');
      s1.setAttribute('offset', '0%');   s1.setAttribute('stop-color', '#7aa2ff33');
      s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#6ef3c533');
      grad.appendChild(s1); grad.appendChild(s2);
      defs.appendChild(grad);
    }
  }

  function getLayer(cls) {
    const NS = VizCFG.NS;
    let g = S.svg.querySelector(`g.${cls}`);
    if (!g) {
      g = document.createElementNS(NS, 'g');
      g.setAttribute('class', cls);
      if (cls === 'ranges') S.svg.insertBefore(g, S.svg.firstChild || null);
      else S.svg.appendChild(g);
    }
    return g;
  }

  function computeRadii(items) {
    if (!items.length) return { radii: [], width: 600 };
    const vals = items.map(x => x.value);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const span = Math.max(1, maxV - minV);
    const radii = vals.map(v => VizCFG.R_MIN + (v - minV) * (VizCFG.R_MAX - VizCFG.R_MIN) / span);
    const content = radii.reduce((s, r) => s + 2*r, 0) + VizCFG.GAP * Math.max(0, radii.length - 1);
    const width = Math.max(400, Math.ceil(VizCFG.PAD*2 + content));
    return { radii, width };
  }

  function applyViewBoxWidth(w) {
    if (S.svg) S.svg.setAttribute('viewBox', `0 0 ${w} 280`);
  }

  function centersX(order) {
    const xs = [];
    let x = VizCFG.PAD;
    order.forEach((it, idx) => {
      x += it.r; xs.push(x);
      x += it.r + (idx < order.length-1 ? VizCFG.GAP : 0);
    });
    return xs;
  }

  function createNode(it, x, y) {
    const NS = VizCFG.NS;
    const g = document.createElementNS(NS, 'g');
    g.classList.add('item');
    g.dataset.id = it.id;

    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(it.r));
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', '0'); t.setAttribute('y', '0');
    t.textContent = String(it.value);

    g.appendChild(c); g.appendChild(t);
    getLayer('items').appendChild(g);

    // СЃС‚Р°СЂС‚ Р±РµР· РґРµСЂРіР°РЅСЊСЏ
    if (window.gsap) gsap.set(g, { x, y });
    else g.style.transform = `translate(${x}px, ${y}px)`;

    S.nodesById.set(it.id, g);
    return g;
  }

  function layout(duration = 0.35) {
    const xs = centersX(S.order);
    S.order.forEach((it, idx) => {
      const g = S.nodesById.get(it.id); if (!g) return;
      if (window.gsap) gsap.to(g, { duration, x: xs[idx], y: VizCFG.CY });
      else g.style.transform = `translate(${xs[idx]}px, ${VizCFG.CY}px)`;
    });
    if (window.VizRanges) VizRanges.recompute();
  }

  function relayoutWithRadii(duration = VizDUR.set) {
    const { radii, width } = computeRadii(S.order);
    S.order.forEach((it, i) => it.r = radii[i]);
    applyViewBoxWidth(width);
    // РѕР±РЅРѕРІРёРј r Сѓ РєСЂСѓРіРѕРІ
    S.order.forEach(it => {
      const g = S.nodesById.get(it.id);
      const c = g && g.querySelector('circle');
      if (c) c.setAttribute('r', String(it.r));
    });
    layout(duration);
  }

  function build(values) {
    clearSVG();
    ensureDefs();
    getLayer('ranges'); getLayer('items');

    S.order = values.map(v => ({ id: uid(), value: v, r: VizCFG.R_MIN }));
    const { radii, width } = computeRadii(S.order);
    S.order.forEach((it, i) => it.r = radii[i]);
    applyViewBoxWidth(width);

    const xs = centersX(S.order);
    S.order.forEach((it, i) => createNode(it, xs[i], VizCFG.CY));
  }

  const API = {
    _S: S,
    build,
    layout,
    relayoutWithRadii,
    centersX,
    clearSVG,
    createNode,
    applyViewBoxWidth,
    swapOrder(i, j) { [S.order[i], S.order[j]] = [S.order[j], S.order[i]]; },
    moveOrder(from, to) {
      const [n] = S.order.splice(from, 1);
      S.order.splice(to, 0, n);
    },
    nodeAtIndex(i) { const it = S.order[i]; return it ? S.nodesById.get(it.id) : null; },
    updateValueAt(i, value) {
      const it = S.order[i]; if (!it) return;
      it.value = value;
      const g = API.nodeAtIndex(i);
      const t = g && g.querySelector('text');
      if (t) t.textContent = String(value);
    }
  };

  window.VizState = API;
})();
