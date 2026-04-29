// Graph editor with interactive SVG + draggable nodes
(function () {
  const ui = {
    nodeLabel: document.getElementById('node-label'),
    addNode: document.getElementById('add-node'),
    clear: document.getElementById('clear-graph'),
    edgeFrom: document.getElementById('edge-from'),
    edgeTo: document.getElementById('edge-to'),
    addEdge: document.getElementById('add-edge'),
    removeNode: document.getElementById('remove-node'),
    deleteNode: document.getElementById('delete-node'),
    deleteEdge: document.getElementById('delete-edge'),
    matrixLabels: document.getElementById('adj-matrix-labels'),
    matrixInput: document.getElementById('adj-matrix-input'),
    matrixMap: document.getElementById('adj-matrix-map'),
    start: document.getElementById('start-node'),
    end: document.getElementById('end-node'),
    nodesBox: document.getElementById('graph-nodes'),
    edgesBox: document.getElementById('graph-edges'),
    stage: document.getElementById('graph-stage')
  };

  const nodes = [];
  const edges = [];
  const radius = 18;
  let matrixAutoApplyTimer = 0;
  const nodeStates = new Map(); // label -> Set(state)
  const edgeStates = new Map(); // key -> Set(state)
  const nodeEls = new Map();    // label -> <g>
  const edgeEls = new Map();    // key -> <line>
  const NODE_STATE_CLASSES = ['start', 'end', 'frontier', 'visited', 'current', 'path', 'notfound'];
  const EDGE_STATE_CLASSES = ['active', 'path', 'notfound'];

  const NS = 'http://www.w3.org/2000/svg';
  const edgesLayer = ui.stage ? ui.stage.querySelector('.graph-edges-layer') : null;
  const nodesLayer = ui.stage ? ui.stage.querySelector('.graph-nodes-layer') : null;

  function labelByIndex(index) {
    const base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let n = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    let out = '';
    do {
      out = base[n % base.length] + out;
      n = Math.floor(n / base.length) - 1;
    } while (n >= 0);
    return out;
  }

  function nextLabel() {
    return labelByIndex(nodes.length);
  }

  function normalizeLabel(label) {
    return String(label || '').trim();
  }

  function ensureUniqueLabel(label) {
    let out = label;
    let i = 1;
    while (nodes.some(n => n.label === out)) {
      out = label + i;
      i++;
    }
    return out;
  }

  function uniqueLabelInSet(label, used) {
    let out = label;
    let i = 1;
    while (used.has(out)) {
      out = `${label}${i}`;
      i++;
    }
    used.add(out);
    return out;
  }

  function splitLabelTokens(text) {
    return String(text || '')
      .split(/[,\s;]+/)
      .map(token => token.trim())
      .filter(Boolean);
  }

  function inferMatrixSizeFromInput(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .length;
  }

  function resolveMatrixLabelsForSize(size, labelsText) {
    const n = Math.max(0, Number.isFinite(size) ? Math.floor(size) : 0);
    const tokens = splitLabelTokens(labelsText);
    const used = new Set();
    const labels = [];
    for (let i = 0; i < n; i++) {
      const raw = normalizeLabel(tokens[i] || '');
      const fallback = labelByIndex(i);
      const candidate = raw || fallback;
      labels.push(uniqueLabelInSet(candidate, used));
    }
    return labels;
  }

  function stageSize() {
    if (!ui.stage) return { w: 600, h: 280 };
    const vb = ui.stage.viewBox && ui.stage.viewBox.baseVal;
    if (vb && vb.width && vb.height) {
      return { w: vb.width, h: vb.height };
    }
    const box = ui.stage.getBoundingClientRect();
    return {
      w: Math.max(300, Math.floor(box.width || 600)),
      h: Math.max(200, Math.floor(box.height || 280))
    };
  }

  function defaultPosition(index) {
    const { w, h } = stageSize();
    return { x: Math.round(w / 2), y: Math.round(h / 2) };
  }

  function renderNodesList() {
    if (!ui.nodesBox) return;
    ui.nodesBox.innerHTML = '';
    if (!nodes.length) {
      ui.nodesBox.textContent = '- empty -';
      return;
    }
    nodes.forEach(n => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = n.label;
      ui.nodesBox.appendChild(chip);
    });
  }

  function renderEdgesList() {
    if (!ui.edgesBox) return;
    ui.edgesBox.innerHTML = '';
    if (!edges.length) {
      ui.edgesBox.textContent = '- empty -';
      return;
    }
    edges.forEach(e => {
      const item = document.createElement('span');
      item.className = 'graph-edge';
      item.textContent = e.from + ' -> ' + e.to;
      ui.edgesBox.appendChild(item);
    });
  }

  function fillSelect(selectEl, values) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';
    if (!values.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-';
      selectEl.appendChild(opt);
      selectEl.disabled = true;
      return;
    }
    selectEl.disabled = false;
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
    if (values.includes(current)) selectEl.value = current;
    else selectEl.value = values[0];
  }

  function syncSelects() {
    const labels = nodes.map(n => n.label);
    fillSelect(ui.edgeFrom, labels);
    fillSelect(ui.edgeTo, labels);
    fillSelect(ui.removeNode, labels);
    fillSelect(ui.start, labels);
    fillSelect(ui.end, labels);
  }

  function buildAdjacencyMatrixFromGraph() {
    const n = nodes.length;
    const indexByLabel = new Map();
    nodes.forEach((node, index) => indexByLabel.set(node.label, index));

    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    edges.forEach((edge) => {
      const from = indexByLabel.get(edge.from);
      const to = indexByLabel.get(edge.to);
      if (!Number.isInteger(from) || !Number.isInteger(to)) return;
      matrix[from][to] = 1;
    });
    return matrix;
  }

  function matrixToText(matrix) {
    if (!Array.isArray(matrix) || !matrix.length) return '';
    return matrix.map(row => row.join(' ')).join('\n');
  }

  function matrixLabelsSeedForSize(size) {
    if (ui.matrixLabels) return ui.matrixLabels.value || '';
    if (size <= 0) return '';
    const labels = [];
    for (let i = 0; i < size; i++) {
      if (i < nodes.length && nodes[i] && nodes[i].label) labels.push(nodes[i].label);
      else labels.push(labelByIndex(i));
    }
    return labels.join(' ');
  }

  function syncMatrixInputFromGraph() {
    if (!ui.matrixInput) return;
    const text = matrixToText(buildAdjacencyMatrixFromGraph());
    if (ui.matrixInput.value !== text) {
      ui.matrixInput.value = text;
    }
  }

  function clearSvg() {
    if (edgesLayer) edgesLayer.innerHTML = '';
    if (nodesLayer) nodesLayer.innerHTML = '';
    nodeEls.clear();
    edgeEls.clear();
  }

  function edgeKey(from, to) {
    return `${from}->${to}`;
  }

  function applyNodeClasses(label) {
    const g = nodeEls.get(label);
    if (!g) return;
    NODE_STATE_CLASSES.forEach(cls => g.classList.remove(cls));
    const set = nodeStates.get(label);
    if (set) set.forEach(cls => g.classList.add(cls));
  }

  function applyEdgeClasses(key) {
    const line = edgeEls.get(key);
    if (!line) return;
    EDGE_STATE_CLASSES.forEach(cls => line.classList.remove(cls));
    const set = edgeStates.get(key);
    if (set) set.forEach(cls => line.classList.add(cls));
  }

  function ensureLine(e) {
    if (!edgesLayer) return null;
    const key = edgeKey(e.from, e.to);
    let line = edgesLayer.querySelector(`[data-from="${e.from}"][data-to="${e.to}"]`);
    if (!line) {
      const isLoop = e.from === e.to;
      line = document.createElementNS(NS, isLoop ? 'path' : 'line');
      line.setAttribute('class', 'graph-edge-line');
      line.setAttribute('marker-end', 'url(#graph-arrow)');
      line.setAttribute('stroke-linecap', 'round');
      if (isLoop) line.setAttribute('fill', 'none');
      line.dataset.from = e.from;
      line.dataset.to = e.to;
      edgesLayer.appendChild(line);
    }
    edgeEls.set(key, line);
    applyEdgeClasses(key);
    return line;
  }

  function updateEdges() {
    edges.forEach(e => {
      const from = nodes.find(n => n.label === e.from);
      const to = nodes.find(n => n.label === e.to);
      if (!from || !to) return;
      const line = ensureLine(e);
      if (!line) return;
      const isLoop = e.from === e.to;
      if (isLoop && line.tagName.toLowerCase() === 'path') {
        const startAngle = -Math.PI / 3;
        const endAngle = -2 * Math.PI / 3;
        const sx = from.x + radius * Math.cos(startAngle);
        const sy = from.y + radius * Math.sin(startAngle);
        const ex = from.x + radius * Math.cos(endAngle);
        const ey = from.y + radius * Math.sin(endAngle);
        const loopLift = radius * 2.2;
        const loopOut = radius * 2.4;
        const c1x = from.x + loopOut;
        const c1y = from.y - loopLift;
        const c2x = from.x - loopOut;
        const c2y = from.y - loopLift;
        const d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
        line.setAttribute('d', d);
      } else if (!isLoop && line.tagName.toLowerCase() === 'line') {
        let x1 = from.x;
        let y1 = from.y;
        let x2 = to.x;
        let y2 = to.y;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const startPad = radius;
        const endPad = radius;
        if (dist && dist > startPad + endPad) {
          x1 += (dx / dist) * startPad;
          y1 += (dy / dist) * startPad;
          x2 -= (dx / dist) * endPad;
          y2 -= (dy / dist) * endPad;
        }
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
      }
      applyEdgeClasses(edgeKey(e.from, e.to));
    });
  }

  function toSvgPoint(clientX, clientY) {
    if (!ui.stage) return { x: clientX, y: clientY };
    const pt = ui.stage.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = ui.stage.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: clientX, y: clientY };
  }

  function attachDrag(node, g) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onDown = (e) => {
      dragging = true;
      g.classList.add('dragging');
      g.setPointerCapture(e.pointerId);
      const p = toSvgPoint(e.clientX, e.clientY);
      offsetX = p.x - node.x;
      offsetY = p.y - node.y;
    };

    const onMove = (e) => {
      if (!dragging) return;
      const p = toSvgPoint(e.clientX, e.clientY);
      node.x = p.x - offsetX;
      node.y = p.y - offsetY;
      if (window.gsap) gsap.set(g, { x: node.x, y: node.y });
      else g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      updateEdges();
    };

    const onUp = () => {
      dragging = false;
      g.classList.remove('dragging');
    };

    g.addEventListener('pointerdown', onDown);
    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup', onUp);
    g.addEventListener('pointercancel', onUp);
  }

  function renderNode(node) {
    if (!nodesLayer) return;
    let g = nodesLayer.querySelector(`[data-id="${node.id}"]`);
    if (!g) {
      g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'graph-node');
      g.dataset.id = node.id;
      g.dataset.label = node.label;

      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', String(radius));

      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', '0');
      t.setAttribute('y', '0');
      t.textContent = node.label;

      g.appendChild(c);
      g.appendChild(t);
      nodesLayer.appendChild(g);
      attachDrag(node, g);
    }
    nodeEls.set(node.label, g);
    applyNodeClasses(node.label);
    if (window.gsap) gsap.set(g, { x: node.x, y: node.y });
    else g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
  }

  function renderGraph() {
    clearSvg();
    nodes.forEach(renderNode);
    updateEdges();
  }

  function syncUI() {
    renderNodesList();
    renderEdgesList();
    syncSelects();
    renderGraph();
    syncMatrixInputFromGraph();
    renderMatrixMappingPreview();
  }

  function setNodeState(label, state, enabled = true) {
    const key = normalizeLabel(label);
    if (!key) return;
    const set = nodeStates.get(key) || new Set();
    if (enabled) set.add(state);
    else set.delete(state);
    nodeStates.set(key, set);
    applyNodeClasses(key);
  }

  function clearNodeState(label, state) {
    setNodeState(label, state, false);
  }

  function clearNodeStateAll(state) {
    nodeEls.forEach((_, key) => {
      const set = nodeStates.get(key) || new Set();
      set.delete(state);
      nodeStates.set(key, set);
      applyNodeClasses(key);
    });
  }

  function setEdgeState(from, to, state, enabled = true) {
    const key = edgeKey(from, to);
    const set = edgeStates.get(key) || new Set();
    if (enabled) set.add(state);
    else set.delete(state);
    edgeStates.set(key, set);
    applyEdgeClasses(key);
  }

  function clearEdgeStateAll(state) {
    edgeEls.forEach((_, key) => {
      const set = edgeStates.get(key) || new Set();
      set.delete(state);
      edgeStates.set(key, set);
      applyEdgeClasses(key);
    });
  }

  function clearStates() {
    nodeStates.clear();
    edgeStates.clear();
    nodeEls.forEach(g => {
      NODE_STATE_CLASSES.forEach(cls => g.classList.remove(cls));
    });
    edgeEls.forEach(line => {
      EDGE_STATE_CLASSES.forEach(cls => line.classList.remove(cls));
    });
  }

  function markPath(nodesPath) {
    if (!Array.isArray(nodesPath)) return;
    clearNodeStateAll('path');
    clearEdgeStateAll('path');
    nodesPath.forEach(label => setNodeState(label, 'path', true));
    for (let i = 0; i < nodesPath.length - 1; i++) {
      setEdgeState(nodesPath[i], nodesPath[i + 1], 'path', true);
    }
  }

  function flashNotFound() {
    const dur = Math.max(300, (window.__algoDelayMs || 200) * 2);
    nodes.forEach(n => setNodeState(n.label, 'notfound', true));
    edges.forEach(e => setEdgeState(e.from, e.to, 'notfound', true));
    setTimeout(() => {
      clearNodeStateAll('notfound');
      clearEdgeStateAll('notfound');
    }, dur);
  }

  function addNode(label) {
    const clean = normalizeLabel(label) || nextLabel();
    const unique = ensureUniqueLabel(clean);
    const pos = defaultPosition(nodes.length);
    nodes.push({ id: 'n_' + Math.random().toString(36).slice(2, 8), label: unique, x: pos.x, y: pos.y });
    syncUI();
  }

  function addEdge(from, to) {
    if (!from || !to) return;
    const exists = edges.some(e => e.from === from && e.to === to);
    if (exists) return;
    edges.push({ from, to });
    renderEdgesList();
    updateEdges();
    syncMatrixInputFromGraph();
    renderMatrixMappingPreview();
  }

  function removeEdge(from, to) {
    if (!from || !to) return;
    const idx = edges.findIndex(e => e.from === from && e.to === to);
    if (idx < 0) return;
    edges.splice(idx, 1);
    const key = edgeKey(from, to);
    edgeStates.delete(key);
    const line = edgeEls.get(key);
    if (line && line.parentNode) line.parentNode.removeChild(line);
    edgeEls.delete(key);
    renderEdgesList();
    updateEdges();
    syncMatrixInputFromGraph();
    renderMatrixMappingPreview();
  }

  function removeNode(label) {
    const key = normalizeLabel(label);
    if (!key) return;
    const idx = nodes.findIndex(n => n.label === key);
    if (idx < 0) return;
    nodes.splice(idx, 1);
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i];
      if (e.from === key || e.to === key) {
        edges.splice(i, 1);
        const eKey = edgeKey(e.from, e.to);
        edgeStates.delete(eKey);
        const line = edgeEls.get(eKey);
        if (line && line.parentNode) line.parentNode.removeChild(line);
        edgeEls.delete(eKey);
      }
    }
    nodeStates.delete(key);
    nodeEls.delete(key);
    [...edgeStates.keys()].forEach(k => {
      if (k.startsWith(`${key}->`) || k.endsWith(`->${key}`)) edgeStates.delete(k);
    });
    syncUI();
  }

  function clearGraph() {
    nodes.length = 0;
    edges.length = 0;
    clearStates();
    syncUI();
  }

  function renderMatrixMappingPreview() {
    if (!ui.matrixMap) return;

    const rawMatrix = ui.matrixInput ? ui.matrixInput.value : '';
    const size = inferMatrixSizeFromInput(rawMatrix);
    const labels = resolveMatrixLabelsForSize(size, matrixLabelsSeedForSize(size));

    ui.matrixMap.innerHTML = '';

    if (!size) {
      ui.matrixMap.classList.add('is-hidden');
      return;
    }
    ui.matrixMap.classList.remove('is-hidden');

    const title = document.createElement('div');
    title.className = 'adj-matrix-map-title';
    title.textContent = `Порядок вершин для матрицы ${size}×${size}:`;
    ui.matrixMap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'adj-matrix-map-grid';
    labels.forEach((label, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'adj-matrix-map-item';
      item.textContent = `${index + 1} ↔ ${label}`;
      item.title = `Строка и столбец ${index + 1} соответствуют вершине ${label}`;
      item.addEventListener('click', () => {
        if (!ui.nodeLabel) return;
        ui.nodeLabel.value = label;
        ui.nodeLabel.focus();
        if (typeof ui.nodeLabel.select === 'function') ui.nodeLabel.select();
      });
      grid.appendChild(item);
    });
    ui.matrixMap.appendChild(grid);

    try {
      parseAdjacencyMatrixText(rawMatrix);
    } catch (err) {
      const error = document.createElement('div');
      error.className = 'adj-matrix-map-error';
      error.textContent = err && err.message ? err.message : 'Проверьте формат матрицы.';
      ui.matrixMap.appendChild(error);
    }
  }

  function parseAdjacencyMatrixText(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      throw new Error('Матрица пустая.');
    }

    const matrix = lines.map((line, rowIndex) => {
      const tokens = line.split(/[\s,;]+/).filter(Boolean);
      if (!tokens.length) {
        throw new Error(`Пустая строка в матрице: ${rowIndex + 1}.`);
      }
      return tokens.map((token, colIndex) => {
        const value = Number(token);
        if (!Number.isFinite(value)) {
          throw new Error(`Некорректное число в строке ${rowIndex + 1}, столбце ${colIndex + 1}: "${token}".`);
        }
        return value;
      });
    });

    const n = matrix.length;
    matrix.forEach((row, i) => {
      if (row.length !== n) {
        throw new Error(`Матрица должна быть квадратной: строка ${i + 1} содержит ${row.length} элементов, ожидалось ${n}.`);
      }
    });

    return matrix;
  }

  function setGraphFromMatrix(matrix, labels) {
    if (!Array.isArray(matrix) || !matrix.length) {
      clearGraph();
      return;
    }

    const previousNodeByLabel = new Map();
    nodes.forEach((n) => {
      previousNodeByLabel.set(n.label, { x: n.x, y: n.y, id: n.id });
    });

    nodes.length = 0;
    edges.length = 0;
    clearStates();

    const n = matrix.length;
    const resolvedLabels = Array.isArray(labels) && labels.length === n
      ? labels
      : resolveMatrixLabelsForSize(n, '');
    for (let i = 0; i < n; i++) {
      const label = resolvedLabels[i];
      const oldNode = previousNodeByLabel.get(label);
      const pos = oldNode || defaultPosition(i);
      nodes.push({
        id: oldNode && oldNode.id ? oldNode.id : ('n_' + Math.random().toString(36).slice(2, 8)),
        label,
        x: pos.x,
        y: pos.y
      });
    }

    const nodeLabels = nodes.map(n => n.label);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (matrix[i][j] !== 0) {
          edges.push({ from: nodeLabels[i], to: nodeLabels[j] });
        }
      }
    }

    syncUI();
  }

  function applyMatrixFromInputs() {
    const matrixText = ui.matrixInput ? ui.matrixInput.value : '';
    if (!String(matrixText || '').trim()) {
      return false;
    }

    try {
      const matrix = parseAdjacencyMatrixText(matrixText);
      const labels = resolveMatrixLabelsForSize(matrix.length, matrixLabelsSeedForSize(matrix.length));
      setGraphFromMatrix(matrix, labels);
      return true;
    } catch (err) {
      return false;
    }
  }

  function scheduleAutoApplyMatrix() {
    if (matrixAutoApplyTimer) {
      clearTimeout(matrixAutoApplyTimer);
      matrixAutoApplyTimer = 0;
    }
    matrixAutoApplyTimer = window.setTimeout(() => {
      matrixAutoApplyTimer = 0;
      applyMatrixFromInputs();
    }, 250);
  }

  if (ui.addNode) {
    ui.addNode.addEventListener('click', () => {
      addNode(ui.nodeLabel ? ui.nodeLabel.value : '');
      if (ui.nodeLabel) ui.nodeLabel.value = '';
    });
  }

  if (ui.addEdge) {
    ui.addEdge.addEventListener('click', () => {
      addEdge(ui.edgeFrom ? ui.edgeFrom.value : '', ui.edgeTo ? ui.edgeTo.value : '');
    });
  }

  if (ui.deleteEdge) {
    ui.deleteEdge.addEventListener('click', () => {
      removeEdge(ui.edgeFrom ? ui.edgeFrom.value : '', ui.edgeTo ? ui.edgeTo.value : '');
    });
  }

  if (ui.deleteNode) {
    ui.deleteNode.addEventListener('click', () => {
      removeNode(ui.removeNode ? ui.removeNode.value : '');
    });
  }

  if (ui.clear) {
    ui.clear.addEventListener('click', clearGraph);
  }

  if (ui.matrixInput) {
    ui.matrixInput.addEventListener('input', () => {
      renderMatrixMappingPreview();
      scheduleAutoApplyMatrix();
    });
  }

  if (ui.matrixLabels) {
    ui.matrixLabels.addEventListener('input', () => {
      renderMatrixMappingPreview();
      scheduleAutoApplyMatrix();
    });
  }

  window.GraphEditor = {
    getAdjacencyList() {
      const out = {};
      nodes.forEach(n => { out[n.label] = []; });
      edges.forEach(e => {
        if (!out[e.from]) out[e.from] = [];
        out[e.from].push(e.to);
      });
      return out;
    },
    getBfsSelection() {
      return { start: ui.start ? ui.start.value : '', end: ui.end ? ui.end.value : '' };
    },
    getDfsSelection() {
      return { start: ui.start ? ui.start.value : '', end: ui.end ? ui.end.value : '' };
    },
    setNodeState,
    clearNodeState,
    clearNodeStateAll,
    setEdgeState,
    clearEdgeStateAll,
    clearStates,
    markPath,
    flashNotFound,
    clearGraph,
    applyAdjacencyMatrix(text, labelsText) {
      const matrix = parseAdjacencyMatrixText(text);
      const labels = resolveMatrixLabelsForSize(matrix.length, labelsText || matrixLabelsSeedForSize(matrix.length));
      setGraphFromMatrix(matrix, labels);
    }
  };

  window.addEventListener('resize', () => renderGraph());
  syncUI();
  renderMatrixMappingPreview();
})();

