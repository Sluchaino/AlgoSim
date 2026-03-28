(function () {
  let editor;
  const consoleEl = document.getElementById('console');
  const statusBox = document.getElementById('run-status');
  const statusText = document.getElementById('run-status-text');
  const timerEl = document.getElementById('run-timer');
  const stageTimeEls = {};
  const stageStepEls = {};
  const STAGES = ['Queued', 'Compiling', 'Running', 'Completed', 'Failed'];
  let timerId = null;
  let timerStart = null;
  let currentStage = null;
  let stageStart = null;
  const stageDurations = new Map();
  const stageSeen = new Set();

  document.querySelectorAll('[data-stage-time]').forEach(el => {
    stageTimeEls[el.dataset.stageTime] = el;
  });
  document.querySelectorAll('[data-stage]').forEach(el => {
    stageStepEls[el.dataset.stage] = el;
  });

  function log(line) {
    if (!consoleEl) return;
    consoleEl.textContent += (line ?? '') + "\n";
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function setStatus(text) {
    if (statusText) statusText.textContent = text || 'Idle';
    if (statusBox) statusBox.dataset.state = text || 'Idle';
  }

  function normalizeStage(stage) {
    const raw = String(stage || '').trim();
    const lower = raw.toLowerCase();
    if (lower === 'queued') return 'Queued';
    if (lower === 'compiling') return 'Compiling';
    if (lower === 'running') return 'Running';
    if (lower === 'completed') return 'Completed';
    if (lower === 'failed') return 'Failed';
    return raw;
  }

  function formatStageMs(ms) {
    const secs = Math.max(0, Math.round(ms / 1000));
    return `${secs} сек`;
  }

  function renderStageDurations() {
    const now = Date.now();
    STAGES.forEach(stage => {
      let ms = stageDurations.get(stage) || 0;
      if (currentStage === stage && stageStart) {
        ms += now - stageStart;
      }
      if (stageTimeEls[stage]) stageTimeEls[stage].textContent = formatStageMs(ms);
    });
  }

  function resetStageDurations() {
    STAGES.forEach(stage => stageDurations.set(stage, 0));
    currentStage = null;
    stageStart = null;
    Object.values(stageStepEls).forEach(el => el.classList.remove('is-active'));
    Object.values(stageStepEls).forEach(el => el.classList.add('is-hidden'));
    stageSeen.clear();
    renderStageDurations();
  }

  function setActiveStage(stage) {
    Object.values(stageStepEls).forEach(el => el.classList.remove('is-active'));
    const el = stageStepEls[stage];
    if (el) el.classList.add('is-active');
  }

  function showStage(stage) {
    const el = stageStepEls[stage];
    if (!el) return;
    el.classList.remove('is-hidden');
    stageSeen.add(stage);
  }

  function enterStage(stage) {
    const s = normalizeStage(stage);
    if (!STAGES.includes(s)) return;
    showStage(s);
    const now = Date.now();
    if (currentStage && stageStart) {
      const prev = stageDurations.get(currentStage) || 0;
      stageDurations.set(currentStage, prev + (now - stageStart));
    }
    currentStage = s;
    stageStart = now;
    setActiveStage(s);
    renderStageDurations();
  }

  function finalizeStages(finalStage) {
    const now = Date.now();
    if (currentStage && stageStart) {
      const prev = stageDurations.get(currentStage) || 0;
      stageDurations.set(currentStage, prev + (now - stageStart));
    }
    currentStage = null;
    stageStart = null;
    const s = normalizeStage(finalStage);
    if (STAGES.includes(s)) {
      showStage(s);
      setActiveStage(s);
    }
    STAGES.forEach(stage => {
      if (!stageSeen.has(stage)) {
        showStage(stage);
      }
    });
    renderStageDurations();
  }

  function handleStatusStage(state) {
    const s = normalizeStage(state);
    if (!STAGES.includes(s)) return;
    if (s === 'Completed' || s === 'Failed') {
      finalizeStages(s);
      return;
    }
    if (currentStage !== s) enterStage(s);
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startTimer() {
    timerStart = Date.now();
    if (timerEl) timerEl.textContent = '00:00';
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      if (!timerStart) return;
      const elapsed = Date.now() - timerStart;
      if (timerEl) timerEl.textContent = formatElapsed(elapsed);
      renderStageDurations();
    }, 200);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // ---------- Monaco ----------
  window.__monacoReady = window.__monacoReady || new Promise((resolve) => {
    require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
    require(['vs/editor/editor.main'], function () { resolve(window.monaco); });
  });

  function getAlgoKey() {
    const key = (location.hash || '').replace('#', '').trim().toLowerCase();
    return key || 'insertion';
  }

  function getModeKey() {
    const mode = window.getAlgoMode ? window.getAlgoMode() : 'auto';
    return mode === 'controlled' ? 'controlled' : 'auto';
  }

  function resolveTemplateKey(algo, mode) {
    const safeAlgo = algo || 'insertion';
    if (mode === 'controlled') {
      const specific = `controlled_${safeAlgo}`;
      if (window.TEMPLATES && window.TEMPLATES[specific]) return specific;
      if (window.TEMPLATES && window.TEMPLATES.controlled) return 'controlled';
    }
    if (window.TEMPLATES && window.TEMPLATES[safeAlgo]) return safeAlgo;
    return 'insertion';
  }

  function applyTemplateFromContext() {
    if (!editor || !window.TEMPLATES) return;
    const key = resolveTemplateKey(getAlgoKey(), getModeKey());
    const next = window.TEMPLATES[key] || window.TEMPLATES.onlyFunction;
    if (typeof next === 'string') {
      editor.setValue(next);
    }
  }

  window.updateEditorTemplate = applyTemplateFromContext;

  (async function initEditor(){
    await window.__monacoReady;
    editor = monaco.editor.create(document.getElementById('editor'), {
      value: '',
      language: 'csharp',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14
    });
    applyTemplateFromContext();
  })();

  // Update template when algo or mode changes
  window.addEventListener('hashchange', () => applyTemplateFromContext());
  const modeInputs = Array.from(document.querySelectorAll('input[name="algo-mode"]'));
  modeInputs.forEach(input => {
    input.addEventListener('change', () => applyTemplateFromContext());
  });

  // ---------- Cleanup: strip usings/namespaces and normalize function ----------
  function stripUsingsAndNamespaces(text) {
    let out = String(text ?? '');
    out = out.replace(/^\s*namespace\s+[A-Za-z_][\w.]*\s*;\s*$/gm, '');
    for (;;) {
      const m = out.match(/^\s*namespace\s+[^{\n]+\s*\{([\s\S]*)\}\s*$/);
      if (!m) break;
      out = m[1];
    }
    out = out.replace(/^\s*using\s+[A-Za-z_][\w.]*\s*(=\s*[^;]+)?;\s*$/gm, '');
    return out.trim();
  }

  const ALGO_META = {
    insertion: {
      funcName: 'InsertionSort',
      signature: 'static void InsertionSort(TrackedList a, ITracer t)',
      call: '    InsertionSort(a, t);',
      needsTarget: false,
      printArray: true,
      useTracked: true
    },
    selection: {
      funcName: 'SelectionSort',
      signature: 'static void SelectionSort(TrackedList a, ITracer t)',
      call: '    SelectionSort(a, t);',
      needsTarget: false,
      printArray: true,
      useTracked: true
    },
    quick: {
      funcName: 'QuickSort',
      signature: 'static void QuickSort(TrackedList a, int left, int right, ITracer t)',
      call: '    QuickSort(a, 0, a.Count - 1, t);',
      needsTarget: false,
      printArray: true,
      useTracked: true
    },
    binary: {
      funcName: 'BinarySearch',
      signature: 'static int BinarySearch(TrackedList a, int target, ITracer t)',
      call: '    var idx = BinarySearch(a, target, t);\n    Console.WriteLine(idx);',
      needsTarget: true,
      printArray: false,
      useTracked: true
    }
  };

  const ALGO_META_CONTROLLED = {
    insertion: {
      funcName: 'InsertionSort',
      signature: 'static void InsertionSort(int[] a, ITracer t)',
      call: '    InsertionSort(a, t);',
      needsTarget: false,
      printArray: true,
      useTracked: false
    },
    selection: {
      funcName: 'SelectionSort',
      signature: 'static void SelectionSort(int[] a, ITracer t)',
      call: '    SelectionSort(a, t);',
      needsTarget: false,
      printArray: true,
      useTracked: false
    },
    quick: {
      funcName: 'QuickSort',
      signature: 'static void QuickSort(int[] a, int left, int right, ITracer t)',
      call: '    QuickSort(a, 0, a.Length - 1, t);',
      needsTarget: false,
      printArray: true,
      useTracked: false
    },
    binary: {
      funcName: 'BinarySearch',
      signature: 'static int BinarySearch(int[] a, int target, ITracer t)',
      call: '    var idx = BinarySearch(a, target, t);\n    Console.WriteLine(idx);',
      needsTarget: true,
      printArray: false,
      useTracked: false
    }
  };

  function getAlgoMeta(key) {
    const mode = window.getAlgoMode ? window.getAlgoMode() : 'auto';
    const metaTable = mode === 'controlled' ? ALGO_META_CONTROLLED : ALGO_META;
    return metaTable[key] || metaTable.insertion;
  }

  function normalizeUserFunction(text, signature, funcName) {
    const cleaned = stripUsingsAndNamespaces(text);
    const t = cleaned.trim();
    const fnRe = new RegExp(`^\\s*static\\s+\\w+\\s+${funcName}\\s*\\(`);
    if (fnRe.test(t)) {
      return t.endsWith('}') ? t : (t + '\n}');
    }
    const body = t.replace(/^\{?\s*|\s*\}?$/g, '');
    const indented = body.split('\n').map(l => '  ' + l).join('\n');
    return `${signature}\n{\n${indented}\n}`;
  }

  function csArrayLiteral(arr) {
    return (window.csArrayLiteral ? window.csArrayLiteral(arr) : `new[] { }`);
  }

  function injectArrayIntoCode(src, arr) {
    const lit = csArrayLiteral(arr);
    if (src.includes('__ARRAY__')) return src.replace(/__ARRAY__/g, lit);
    const reTracked = /(new\s+TrackedList\s*\(\s*)new\s*(?:int\s*)?$$\]\s*\{[\s\S]*?\}/m;
    if (reTracked.test(src)) return src.replace(reTracked, (_, prefix) => `${prefix}${lit}`);
    const reAnyNewArray = /new\s*(?:int\s*)?\[$$\s*\{[\s\S]*?\}/m;
    if (reAnyNewArray.test(src)) return src.replace(reAnyNewArray, lit);
    const reInit = /int$$\]\s+\w+\s*=\s*\{[\s\S]*?\}/m;
    if (reInit.test(src)) {
      return src.replace(reInit, m =>
        m.replace(/\{[\s\S]*?\}/, lit.replace(/^new\s*(?:int\s*)?\[$$\s*/, ''))
      );
    }
    return src;
  }

  function isFullProgram(code) {
    return /static\s+void\s+Main\s*\(|\bclass\s+Program\b/.test(code);
  }

  const WRAP_HEADER =
`using System;
using System.Collections.Generic;
using System.Text.Json;
using AlgoTracing;

class Program {
`;
  function buildWrapMain(meta) {
    const isBinary = meta.funcName === 'BinarySearch' && meta.needsTarget;
    const printLine = meta.printArray
      ? (meta.useTracked
        ? '    Console.WriteLine(string.Join(", ", a.ToArray()));'
        : '    Console.WriteLine(string.Join(", ", a));')
      : '';

    const initLines = meta.useTracked
      ? '    int[] raw = ReadValues(out target);\n    var a = new TrackedList(raw, t);\n    TracingExtensions.EmitArray(t, a.ToArray());'
      : '    int[] a = ReadValues(out target);\n    TracingExtensions.EmitArray(t, a);';

    const preCall = (isBinary && meta.useTracked)
      ? '    TracingExtensions.BeginBinarySearch(t, a.Count, target);'
      : '';
    const postCall = (isBinary && meta.useTracked)
      ? '    TracingExtensions.EndBinarySearch(t);'
      : '';

    return `
  static int[] ReadValues(out int target) {
    target = 0;
    var text = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
    try {
      using var doc = JsonDocument.Parse(text);
      var root = doc.RootElement;
      if (root.TryGetProperty("target", out var t) && t.ValueKind == JsonValueKind.Number)
        target = t.GetInt32();
      if (root.TryGetProperty("values", out var arr) && arr.ValueKind == JsonValueKind.Array) {
        var list = new List<int>();
        foreach (var x in arr.EnumerateArray())
          if (x.ValueKind == JsonValueKind.Number) list.Add(x.GetInt32());
        return list.ToArray();
      }
    } catch {}
    return Array.Empty<int>();
  }

  static void Main() {
    ITracer t = new JsonConsoleTracer();
    int target;
${initLines}
${preCall}
${meta.call}
${postCall}
${printLine}
  }
}
`;
  }

  function getTargetValue() {
    const el = document.getElementById('target');
    const v = el ? parseInt(el.value || '', 10) : NaN;
    return Number.isFinite(v) ? v : 0;
  }

  function injectTargetIntoCode(src, target) {
    const val = Number.isFinite(target) ? Math.trunc(target) : 0;
    if (src.includes('__TARGET__')) return src.replace(/__TARGET__/g, String(val));
    return src;
  }

  function buildSourceForRun(rawCode, pageArray, algoKey) {
    if (algoKey === 'bfs' || algoKey === 'dfs') {
      return rawCode;
    }
    const meta = getAlgoMeta(algoKey);
    if (isFullProgram(rawCode)) {
      return rawCode;
    }
    const fn = normalizeUserFunction(rawCode, meta.signature, meta.funcName);
    const composed = WRAP_HEADER + '  ' + fn.replace(/\n/g, '\n  ') + buildWrapMain(meta);
    return composed;
  }

  function extractNumbersFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const bracket = text.match(/$$\s*-?\d+(?:\s*,\s*-?\d+)*\s*$$/);
    if (bracket) {
      const inside = bracket[0].slice(1, -1);
      return inside.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
    }
    if (/^\s*-?\d+(?:\s*,\s*-?\d+)*\s*$/.test(text)) {
      return text.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
    }
    return null;
  }
  function tryParseEnvelope(line) {
    try { const o = JSON.parse(line); if (o && typeof o === 'object' && 'type' in o) return o; } catch {}
    return null;
  }

  

  class LogPlayer {
    constructor(processItem) {
      this.queue = [];
      this.isPlaying = false;
      this.delayMs = 100;
      this.timer = null;
      this.processItem = processItem;
      this.processed = 0;
      this._nextDelayMs = null;
    }
    setDelay(ms) {
      const n = Math.max(0, Math.floor(ms || 0));
      this.delayMs = n;
      if (window.setHighlightDuration) window.setHighlightDuration(n);
      if (this.isPlaying) this._scheduleNext();
    }
    enqueue(items) {
      if (!items) return;
      if (Array.isArray(items)) this.queue.push(...items);
      else this.queue.push(items);
      if (this.isPlaying && this.timer === null) this._scheduleNext();
    }
    clear() { this.queue.length = 0; this.processed = 0; }
    play() { if (this.isPlaying) return; this.isPlaying = true; this._scheduleNext(); }
    pause() { this.isPlaying = false; if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
    stop() { this.pause(); this.clear(); }
    stepOnce() {
      if (this.queue.length === 0) return;
      const item = this.queue.shift();
      try { this.processItem(item); } catch {}
      this.processed++;
    }
    _scheduleNext() {
      if (!this.isPlaying || this.timer !== null || this.queue.length === 0) return;
      const delay = Number.isFinite(this._nextDelayMs) && this._nextDelayMs !== null
        ? Math.max(0, this._nextDelayMs)
        : this.delayMs;
      this._nextDelayMs = null;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.isPlaying || this.queue.length === 0) return;
        const item = this.queue.shift();
        try {
          const extra = this.processItem(item);
          if (Number.isFinite(extra) && extra > 0) {
            this._nextDelayMs = Math.max(this.delayMs, extra);
          }
        } catch {}
        this.processed++;
        this._scheduleNext();
      }, delay);
    }
  }

  const player = new LogPlayer((item) => {
    if (!item) return;
    if (item.type === 'step') {
      const p = item.payload && item.payload.payload ? item.payload.payload : item.payload;
      try { window.handleStepEvent && window.handleStepEvent(p); } catch {}
      if (p && p.kind === 'swap') {
        const ms = (window.VizScene && typeof VizScene.getSwapDelayMs === 'function')
          ? VizScene.getSwapDelayMs()
          : 700;
        return ms;
      }
    }  else if (item.type === 'stderr' && typeof item.payload === 'string') {
      log('[stderr] ' + item.payload);
    }
  });

  const btnPlay = document.getElementById('play');
  const btnPause = document.getElementById('pause');
  const btnReset = document.getElementById('reset');
  const btnStep = document.getElementById('stepOnce');
  const inpDelay = document.getElementById('delay');
  const chkAutoplay = document.getElementById('autoplay');

  // Keep viz playback state in sync with the player
  function updatePlaybackState(playing) {
    if (window.VizScene && window.VizScene.setPlaybackState) {
      window.VizScene.setPlaybackState(playing);
    }
  }

  const BASE_STEP_MS = 500;
  function applySpeed(speedValue) {
    const raw = Number.isFinite(speedValue) ? speedValue : 1;
    const speed = Math.min(3, Math.max(0.25, raw));
    const stepDelay = Math.round(BASE_STEP_MS / speed);
    player.setDelay(stepDelay);
    if (window.VizScene && typeof window.VizScene.setBaseDelay === 'function') {
      window.VizScene.setBaseDelay(stepDelay);
    }
    if (window.VizScene && typeof window.VizScene.setAnimationSpeed === 'function') {
      window.VizScene.setAnimationSpeed(speed);
    }
    if (window.VizScene && typeof window.VizScene.setHighlightDuration === 'function') {
      const highlightMs = Math.max(200, Math.round(stepDelay * 0.7));
      window.VizScene.setHighlightDuration(highlightMs);
    }
    window.__algoDelayMs = stepDelay;
  }

  // Playback controls
  btnPlay && btnPlay.addEventListener('click', () => { 
    player.play(); 
    updatePlaybackState(true);
  });
  
  btnPause && btnPause.addEventListener('click', () => { 
    player.pause(); 
    updatePlaybackState(false);
  });
  
  btnReset && btnReset.addEventListener('click', () => { 
    player.stop(); 
    updatePlaybackState(false);
    // Reset visualization to the initial array
    if (window.VizScene && window.VizScene.setCurrentArray) {
      const initialArray = window.getCurrentArray ? window.getCurrentArray() : [];
      window.VizScene.setCurrentArray(initialArray);
    }
  });

  btnStep && btnStep.addEventListener('click', () => player.stepOnce());
  inpDelay && inpDelay.addEventListener('input', () => {
    const v = parseFloat(inpDelay.value || '1');
    applySpeed(Number.isFinite(v) ? v : 1);
  });
  (function initDelay(){
    const v = inpDelay ? parseFloat(inpDelay.value || '1') : 1;
    applySpeed(Number.isFinite(v) ? v : 1);
  })();

  let currentRunToken = null;
  const runnerBase = (window.RUNNER_BASE || '').replace(/\/+$/, '');

  function buildInputPayload(algo) {
    const key = algo || getAlgoKey();
    if (key === 'bfs' || key === 'dfs') {
      const graph = window.GraphEditor && window.GraphEditor.getAdjacencyList
        ? window.GraphEditor.getAdjacencyList()
        : {};
      const selection = key === 'bfs'
        ? (window.GraphEditor && window.GraphEditor.getBfsSelection ? window.GraphEditor.getBfsSelection() : {})
        : (window.GraphEditor && window.GraphEditor.getDfsSelection ? window.GraphEditor.getDfsSelection() : {});
      return JSON.stringify({ type: 'graph', algo: key, graph, selection });
    }

    const arr = window.getCurrentArray ? window.getCurrentArray() : [];
    const payload = { type: 'array', algo: key, values: arr };
    if (key === 'binary') payload.target = getTargetValue();
    return JSON.stringify(payload);
  }

  function validateBeforeRun(algo) {
    const key = algo || getAlgoKey();
    if (key === 'bfs' || key === 'dfs') {
      const graph = window.GraphEditor && window.GraphEditor.getAdjacencyList
        ? window.GraphEditor.getAdjacencyList()
        : {};
      const nodes = Object.keys(graph || {});
      if (!nodes.length) {
        log('[error] Сначала создайте граф: добавьте хотя бы одну вершину.');
        return false;
      }
      const selection = key === 'bfs'
        ? (window.GraphEditor && window.GraphEditor.getBfsSelection ? window.GraphEditor.getBfsSelection() : {})
        : (window.GraphEditor && window.GraphEditor.getDfsSelection ? window.GraphEditor.getDfsSelection() : {});
      const start = (selection && selection.start) ? String(selection.start).trim() : '';
      const end = (selection && selection.end) ? String(selection.end).trim() : '';
      if (!start || !end) {
        log('[error] Укажите начальную и конечную вершины.');
        return false;
      }
      if (!nodes.includes(start) || !nodes.includes(end)) {
        log('[error] Начальная/конечная вершина должна существовать в графе.');
        return false;
      }
      return true;
    }

    const arr = window.getCurrentArray ? window.getCurrentArray() : [];
    if (!Array.isArray(arr) || arr.length === 0) {
      log('[error] Сначала создайте массив (введите значения или сгенерируйте).');
      return false;
    }

    if (key === 'binary') {
      const targetEl = document.getElementById('target');
      const raw = targetEl ? String(targetEl.value || '').trim() : '';
      if (!raw) {
        log('[error] Для бинарного поиска укажите искомое число.');
        return false;
      }
      const target = parseInt(raw, 10);
      if (!Number.isFinite(target)) {
        log('[error] Искомое число должно быть целым.');
        return false;
      }
    }

    return true;
  }

  function enqueueOutput(output) {
    const lines = String(output || '').split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('__STEP__')) {
        const json = line.slice('__STEP__'.length);
        try {
          const parsed = JSON.parse(json);
          const inner = parsed && parsed.payload ? parsed.payload : parsed;
          player.enqueue({ type: 'step', payload: inner });
        } catch {
          player.enqueue({ type: 'stderr', payload: 'STEP parse error' });
        }
      } else {
        player.enqueue({ type: 'stdout', payload: line });
      }
    }
  }

  async function pollStatus(statusUrl, token) {
    let lastState = null;
    for (;;) {
      if (token.cancelled) return null;
      try {
        const res = await fetch(statusUrl, { cache: 'no-store' });
        if (res.ok) {
          const s = await res.json();
          if (s && s.state && s.state !== lastState) {
            lastState = s.state;
            log(`[status] ${lastState}`);
            setStatus(lastState);
            handleStatusStage(lastState);
          }
          if (s && (s.state === 'Completed' || s.state === 'Failed')) {
            stopTimer();
            return s;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const btnStop = document.getElementById('stop');
  btnStop && btnStop.addEventListener('click', () => {
    if (currentRunToken) currentRunToken.cancelled = true;
    log('[cancel requested]');
    setStatus('Cancelled');
    stopTimer();
  });

  document.getElementById('run').addEventListener('click', async () => {
    if (!editor) return;

    if (currentRunToken) currentRunToken.cancelled = true;
    const token = { cancelled: false };
    currentRunToken = token;
    setStatus('Submitting');
    resetStageDurations();
    startTimer();

    const algoName = getAlgoKey();
    if (!validateBeforeRun(algoName)) return;
    const codeFromEditor = editor.getValue();
    const pageArray = window.getCurrentArray ? window.getCurrentArray() : [];
    const sourceToSend = buildSourceForRun(codeFromEditor, pageArray, algoName);
    const inputPayload = buildInputPayload(algoName);

    if (consoleEl) consoleEl.textContent = '';
    player.stop();

    try {
      const submitUrl = `${runnerBase}/api/submissions`;
      const r = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: algoName, code: sourceToSend, input: inputPayload })
      });
      if (!r.ok) {
        log(`HTTP ${r.status}: failed to submit`);
        setStatus('Error');
        stopTimer();
        return;
      }

      const created = await r.json();
      const id = created.id;
      const statusUrl = created.statusUrl
        ? (created.statusUrl.startsWith('http')
          ? created.statusUrl
          : `${runnerBase}${created.statusUrl.startsWith('/') ? '' : '/'}${created.statusUrl}`)
        : `${runnerBase}/api/submissions/${id}/status`;

      log('[queued]');
      setStatus('Queued');
      handleStatusStage('Queued');

      await pollStatus(statusUrl, token);
      if (token.cancelled) return;

      const resultUrl = `${runnerBase}/api/submissions/${id}`;
      const resultRes = await fetch(resultUrl, { cache: 'no-store' });
      if (!resultRes.ok) {
        log(`HTTP ${resultRes.status}: failed to fetch result`);
        setStatus('Error');
        stopTimer();
        return;
      }

      const result = await resultRes.json();
      if (result && result.error) {
        player.enqueue({ type: 'stderr', payload: result.error });
      }
      enqueueOutput(result && result.output ? result.output : '');

      const auto = chkAutoplay ? !!chkAutoplay.checked : true;
      if (auto) player.play();
      stopTimer();
    } catch (err) {
      log('Run error: ' + (err && err.message ? err.message : String(err)));
      setStatus('Error');
      stopTimer();
    }
  });

  setStatus('Idle');
})();


