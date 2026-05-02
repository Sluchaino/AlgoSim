(function () {
  let editor;
  const consoleEl = document.getElementById('console');
  const statusPanel = window.RunStatusPanel || {};
  const rawLogExport = window.RawLogExport || { bind() {}, reset() {}, remember() {} };
  const normalizeStage = statusPanel.normalizeStage || function (stage) { return stage; };
  const setStatus = statusPanel.setStatus || function () {};
  const resetStageDurations = statusPanel.resetStageDurations || function () {};
  const handleStatusStage = statusPanel.handleStatusStage || function () {};
  const startTimer = statusPanel.startTimer || function () {};
  const stopTimer = statusPanel.stopTimer || function () {};

  function log(line) {
    if (!consoleEl) return;
    consoleEl.textContent += (line ?? '') + "\n";
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  rawLogExport.bind(log);

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
    if (safeAlgo === 'sandbox') {
      const sandboxKind = window.getSandboxKind ? window.getSandboxKind() : 'array';
      return sandboxKind === 'graph' ? 'sandbox_graph' : 'sandbox_array';
    }
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
  window.applyEditorTemplateKey = function (key) {
    if (!editor || !window.TEMPLATES || !key) return;
    const next = window.TEMPLATES[key];
    if (typeof next === 'string') {
      editor.setValue(next);
    }
  };

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

  // Update template when algo changes and keep step timeline isolated per tab
  let lastAlgoForTimeline = getAlgoKey();
  window.addEventListener('hashchange', () => {
    const nextAlgo = getAlgoKey();
    applyTemplateFromContext();
    if (nextAlgo !== lastAlgoForTimeline) {
      clearTimeline();
      setStatus('Idle');
    }
    lastAlgoForTimeline = nextAlgo;
  });
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
      call: '    BinarySearch(a, target, t);',
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
      call: '    BinarySearch(a, target, t);',
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
    const printLine = '';

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
      this.lastItemVisualMs = 0;
      this.onStateChange = null;
    }
    _notifyState() {
      if (typeof this.onStateChange === 'function') {
        try { this.onStateChange(this.isPlaying); } catch {}
      }
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
    setQueue(items, processed = 0) {
      this.pause();
      this.queue = Array.isArray(items) ? items.slice() : [];
      this.processed = Math.max(0, Number.isFinite(processed) ? Math.floor(processed) : 0);
    }
    clear() { this.queue.length = 0; this.processed = 0; }
    play() {
      if (this.isPlaying) return;
      if (this.queue.length === 0) { this.isPlaying = false; this._notifyState(); return; }
      this.isPlaying = true;
      this._notifyState();
      this._scheduleNext();
    }
    pause() {
      this.isPlaying = false;
      if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
      this._notifyState();
    }
    stop() { this.pause(); this.clear(); }
    stepOnce() {
      if (this.queue.length === 0) return;
      const item = this.queue.shift();
      try {
        const extra = this.processItem(item);
        this.lastItemVisualMs = (Number.isFinite(extra) && extra > 0) ? Math.round(extra) : 0;
      } catch {
        this.lastItemVisualMs = 0;
      }
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
          this.lastItemVisualMs = (Number.isFinite(extra) && extra > 0) ? Math.round(extra) : 0;
          if (Number.isFinite(extra) && extra > 0) {
            this._nextDelayMs = Math.max(this.delayMs, extra);
          }
        } catch {
          this.lastItemVisualMs = 0;
        }
        this.processed++;
        if (this.queue.length === 0) {
          this.isPlaying = false;
          this._notifyState();
          return;
        }
        this._scheduleNext();
      }, delay);
    }
  }

  const btnPlayPause = document.getElementById('playPause');
  const btnReset = document.getElementById('reset');
  const btnReplay = document.getElementById('replayAnimation');
  const btnStep = document.getElementById('stepOnce');
  const inpSpeedSwap = document.getElementById('speed-swap');
  const inpSpeedOther = document.getElementById('speed-other');
  const btnSpeedDetails = document.getElementById('toggle-speed-details');
  const speedDetailsPanel = document.getElementById('speed-details-panel');
  const inpSpeedCompare = document.getElementById('speed-compare');
  const inpSpeedRead = document.getElementById('speed-read');
  const inpSpeedWrite = document.getElementById('speed-write');
  const inpSpeedMove = document.getElementById('speed-move');
  const inpSpeedSet = document.getElementById('speed-set');
  const inpSpeedRange = document.getElementById('speed-range-speed');
  const chkAutoplay = document.getElementById('autoplay');
  const stepRange = document.getElementById('step-range');
  const stepList = document.getElementById('steps-list');
  const stepCurrentEl = document.getElementById('step-current');
  const stepTotalEl = document.getElementById('step-total');
  const stepCornerEls = Array.from(document.querySelectorAll('[data-viz-step-corner]'));

  let timelineStepItems = [];
  let timelineInitialArray = [];
  let timelineAlgo = 'insertion';
  let timelineFinalState = null;
  let timelineCursor = 0;
  let timelineUiFrozen = false;
  let stepListAutoFollow = true;
  let stepListProgrammaticScroll = false;
  let stepListProgrammaticTimer = null;
  let suppressTailFinalize = false;
  let timelineDataVersion = 0;
  let binaryStepListFilterCacheVersion = -1;
  let binaryStepListFilterCacheAlgo = '';
  let binaryStepListHiddenRaw = new Set();

  const MS_MIN = 50;
  const MS_MAX = 12000;
  const DEFAULT_OTHER_MS = 500;
  const DEFAULT_SWAP_MS = 3000;
  const DEFAULT_SPEED_CONFIG = {
    swap: DEFAULT_SWAP_MS,
    other: DEFAULT_OTHER_MS,
    compare: DEFAULT_OTHER_MS,
    read: DEFAULT_OTHER_MS,
    write: DEFAULT_OTHER_MS,
    move: DEFAULT_OTHER_MS,
    set: DEFAULT_OTHER_MS,
    range: DEFAULT_OTHER_MS
  };
  let lastSpeedConfig = { ...DEFAULT_SPEED_CONFIG };
  const OTHER_CUSTOM_TEXT = 'своё';
  const OTHER_CUSTOM_TEXT_ALT = 'свое';
  const DETAIL_SPEED_FIELDS = [
    { key: 'compare', el: inpSpeedCompare, label: 'Сравнение' },
    { key: 'read', el: inpSpeedRead, label: 'Чтение' },
    { key: 'write', el: inpSpeedWrite, label: 'Запись' },
    { key: 'move', el: inpSpeedMove, label: 'Перемещение' },
    { key: 'set', el: inpSpeedSet, label: 'Установка значения' },
    { key: 'range', el: inpSpeedRange, label: 'Диапазон' }
  ];

  function parseSpeedInput(el) {
    const raw = (el && typeof el.value === 'string') ? el.value.trim() : '';
    if (!raw) return null;
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function normalizeMsValue(v) {
    return Math.min(MS_MAX, Math.max(MS_MIN, Math.round(v)));
  }

  function isOtherCustomValue(raw) {
    const t = String(raw || '').trim().toLowerCase();
    return t === OTHER_CUSTOM_TEXT || t === OTHER_CUSTOM_TEXT_ALT;
  }

  function setOtherSpeedText(text, mode) {
    if (!inpSpeedOther) return;
    inpSpeedOther.value = text;
    inpSpeedOther.dataset.mode = mode || '';
  }

  function setOtherSpeedNumber(ms) {
    setOtherSpeedText(String(normalizeMsValue(ms)), 'linked');
  }

  function setOtherSpeedCustom() {
    setOtherSpeedText(OTHER_CUSTOM_TEXT, 'custom');
  }

  function setDetailSpeeds(ms) {
    const value = normalizeMsValue(ms);
    DETAIL_SPEED_FIELDS.forEach(field => {
      if (field.el) field.el.value = String(value);
    });
  }

  function getDetailSpeedValues(cfg) {
    return DETAIL_SPEED_FIELDS.map(field => cfg[field.key]).filter(Number.isFinite);
  }

  function areAllEqual(values) {
    if (!Array.isArray(values) || values.length === 0) return true;
    return values.every(v => v === values[0]);
  }

  function validateSpeedField(field, strict, prev) {
    const raw = parseSpeedInput(field.el);
    if (raw === null) {
      if (strict) {
        return { ok: false, error: `[error] Поле "${field.label}" не заполнено. Укажите значение больше ${MS_MIN} мс.` };
      }
      return { ok: true, value: prev };
    }
    if (!Number.isFinite(raw)) {
      if (strict) {
        return { ok: false, error: `[error] Поле "${field.label}" должно быть числом больше ${MS_MIN} мс.` };
      }
      return { ok: true, value: prev };
    }
    if (raw <= 0) {
      if (strict) {
        return { ok: false, error: `[error] Поле "${field.label}" должно быть больше ${MS_MIN} мс.` };
      }
      return { ok: true, value: prev };
    }
    return { ok: true, value: normalizeMsValue(raw) };
  }

  function refreshOtherSpeedField(cfg, mode) {
    const detailValues = getDetailSpeedValues(cfg);
    if (!detailValues.length) {
      setOtherSpeedNumber(DEFAULT_OTHER_MS);
      return;
    }
    if (mode === 'linked') {
      setOtherSpeedNumber(cfg.other);
      return;
    }
    if (areAllEqual(detailValues)) {
      setOtherSpeedNumber(detailValues[0]);
      return;
    }
    setOtherSpeedCustom();
  }

  function syncDetailSpeedsFromOther() {
    const rawOther = parseSpeedInput(inpSpeedOther);
    if (!Number.isFinite(rawOther) || rawOther <= 0) return false;
    const other = normalizeMsValue(rawOther);
    setDetailSpeeds(other);
    setOtherSpeedNumber(other);
    return true;
  }

  function collectSpeedConfig(strict = false) {
    const prev = lastSpeedConfig || { ...DEFAULT_SPEED_CONFIG };
    const cfg = { ...prev };
    const swapField = { key: 'swap', el: inpSpeedSwap, label: 'Обмен' };

    const swapResult = validateSpeedField(swapField, strict, prev.swap);
    if (!swapResult.ok) return swapResult;
    cfg.swap = swapResult.value;

    for (const field of DETAIL_SPEED_FIELDS) {
      const result = validateSpeedField(field, strict, prev[field.key]);
      if (!result.ok) return result;
      cfg[field.key] = result.value;
    }

    const otherRaw = (inpSpeedOther && typeof inpSpeedOther.value === 'string')
      ? inpSpeedOther.value.trim()
      : '';
    const customMode = isOtherCustomValue(otherRaw);

    if (!customMode) {
      const otherParsed = parseSpeedInput(inpSpeedOther);
      if (otherParsed === null || !Number.isFinite(otherParsed) || otherParsed <= 0) {
        if (strict) {
          if (!otherRaw) {
            cfg.other = MS_MIN;
            setOtherSpeedNumber(MS_MIN);
            setDetailSpeeds(cfg.other);
            DETAIL_SPEED_FIELDS.forEach(field => {
              cfg[field.key] = cfg.other;
            });
            return { ok: true, cfg, mode: 'linked' };
          }
          return { ok: false, error: `[error] Поле "Остальное" должно быть числом больше ${MS_MIN} мс или значением "${OTHER_CUSTOM_TEXT}".` };
        }
      } else {
        cfg.other = normalizeMsValue(otherParsed);
        setDetailSpeeds(cfg.other);
        DETAIL_SPEED_FIELDS.forEach(field => {
          cfg[field.key] = cfg.other;
        });
        return { ok: true, cfg, mode: 'linked' };
      }
    }

    const detailValues = getDetailSpeedValues(cfg);
    if (detailValues.length) {
      const avg = Math.round(detailValues.reduce((sum, x) => sum + x, 0) / detailValues.length);
      cfg.other = normalizeMsValue(avg);
    }
    return { ok: true, cfg, mode: 'custom' };
  }

  function applySpeedConfig(strict = false) {
    const parsed = collectSpeedConfig(strict);
    if (!parsed.ok) {
      if (strict && parsed.error) log(parsed.error);
      return false;
    }
    const cfg = parsed.cfg;
    const mode = parsed.mode || 'custom';
    lastSpeedConfig = { ...cfg };
    const stepDelay = cfg.other;
    const swapDelay = cfg.swap;

    player.setDelay(stepDelay);

    if (window.VizScene && typeof window.VizScene.setBaseDelay === 'function') {
      window.VizScene.setBaseDelay(swapDelay);
    }

    if (window.VizDUR) {
      VizDUR.swap = cfg.swap / 1000;
      VizDUR.move = cfg.move / 1000;
      VizDUR.set = cfg.set / 1000;
      VizDUR.range = cfg.range / 1000;
      VizDUR.pulse = cfg.compare / 1000;
    }

    if (window.VizHL && typeof window.VizHL.setPulseProfile === 'function') {
      window.VizHL.setPulseProfile({
        compare: cfg.compare,
        read: cfg.read,
        write: cfg.write,
        swap: Math.max(MS_MIN, Math.min(cfg.swap, cfg.compare)),
        notFound: Math.max(MS_MIN * 2, cfg.other * 2)
      });
    } else if (window.VizScene && typeof window.VizScene.setHighlightDuration === 'function') {
      window.VizScene.setHighlightDuration(cfg.other);
    }

    window.__algoDelayMs = stepDelay;
    refreshOtherSpeedField(cfg, mode);
    return true;
  }

  function toggleSpeedDetails(forceState) {
    if (!speedDetailsPanel) return;
    const show = typeof forceState === 'boolean'
      ? forceState
      : speedDetailsPanel.classList.contains('is-hidden');
    speedDetailsPanel.classList.toggle('is-hidden', !show);
    if (btnSpeedDetails) btnSpeedDetails.textContent = show ? 'Скрыть' : 'Подробнее';
  }

  function formatStepLabel(payload, index) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const kind = p.kind ? String(p.kind) : 'step';

    const step = (text) => `#${index} ${text}`;
    const hasNum = (v) => Number.isFinite(v);
    const valueText = (v) => hasNum(v) ? String(v) : '?';
    const elemText = (v) => hasNum(v) ? `значение ${v}` : 'значение ?';
    const pairText = (a, b) => `${elemText(a)} и ${elemText(b)}`;
    const opText = (op) => {
      const key = String(op || '').trim();
      if (key === '==') return 'равно';
      if (key === '!=') return 'не равно';
      if (key === '>') return 'больше';
      if (key === '>=') return 'больше или равно';
      if (key === '<') return 'меньше';
      if (key === '<=') return 'меньше или равно';
      return key || 'сравнение';
    };
    const resultText = (v) => (v === true ? 'истина' : v === false ? 'ложь' : '?');
    const tagText = (tag) => {
      const key = String(tag || '').trim().toLowerCase();
      if (key === 'key') return 'ключевой элемент';
      if (key === 'min') return 'текущий минимум';
      if (key === 'pivot') return 'опорный элемент (pivot)';
      if (key === 'sorted') return 'элемент в отсортированной части';
      if (key === 'mid') return 'середина диапазона';
      if (key === 'found') return 'найденный элемент';
      return key || 'метка';
    };
    const nodeStateText = (state) => {
      const key = String(state || '').trim().toLowerCase();
      if (key === 'start') return 'стартовая вершина';
      if (key === 'end') return 'целевая вершина';
      if (key === 'frontier') return 'в очереди/стеке';
      if (key === 'visited') return 'уже посещена';
      if (key === 'current') return 'текущая вершина';
      if (key === 'path') return 'вершина итогового пути';
      if (key === 'notfound') return 'поиск неуспешен';
      return key || 'состояние';
    };
    const edgeStateText = (state) => {
      const key = String(state || '').trim().toLowerCase();
      if (key === 'active') return 'активное ребро (проверяем)';
      if (key === 'path') return 'ребро итогового пути';
      if (key === 'notfound') return 'ребро неуспешного поиска';
      return key || 'ребро';
    };
    const previewArray = (arr) => {
      if (!Array.isArray(arr)) return '';
      const max = 6;
      const part = arr.slice(0, max).join(', ');
      return arr.length > max ? `${part}, ...` : part;
    };

    if (kind === 'compare') {
      return step(`Сравнение: ${pairText(p.ai, p.bj)}.`);
    }
    if (kind === 'compareEx') {
      const ai = valueText(p.ai);
      const bj = valueText(p.bj);
      const op = opText(p.op);
      const res = resultText(p.result);
      const constRole = timelineAlgo === 'binary'
        ? 'цель'
        : (timelineAlgo === 'quick'
          ? 'опорный элемент (pivot)'
          : (timelineAlgo === 'insertion' ? 'ключ' : 'константа'));
      if (Number.isInteger(p.i) && p.i >= 0 && p.j === -1) {
        const right = hasNum(p.bj) ? `${constRole} (${bj})` : constRole;
        return step(`Сравнение: ${elemText(p.ai)} ${op} ${right} -> ${res}.`);
      }
      if (p.i === -1 && Number.isInteger(p.j) && p.j >= 0) {
        const left = hasNum(p.ai) ? `${constRole} (${ai})` : constRole;
        return step(`Сравнение: ${left} ${op} ${elemText(p.bj)} -> ${res}.`);
      }
      return step(`Сравнение: ${elemText(p.ai)} ${op} ${elemText(p.bj)} -> ${res}.`);
    }
    if (kind === 'swap') {
      let ai = p.ai;
      let bj = p.bj;
      if ((!hasNum(ai) || !hasNum(bj)) && Array.isArray(p.after) && Number.isInteger(p.i) && Number.isInteger(p.j)) {
        ai = p.after[p.j];
        bj = p.after[p.i];
      }
      return step(`Обмен: ${pairText(ai, bj)}.`);
    }
    if (kind === 'read') {
      return step(`Чтение: берём ${elemText(p.value)}.`);
    }
    if (kind === 'move') {
      if (hasNum(p.value)) return step(`Сдвиг: переносим ${elemText(p.value)} на новую позицию.`);
      return step('Сдвиг элемента на новую позицию.');
    }
    if (kind === 'set') {
      if (hasNum(p.old)) {
        return step(`Запись: значение изменено с ${valueText(p.old)} на ${valueText(p.value)}.`);
      }
      return step(`Запись: устанавливаем значение ${valueText(p.value)}.`);
    }
    if (kind === 'setArray') {
      if (Array.isArray(p.value)) {
        return step(`Инициализация: структура обновлена (${p.value.length} эл.): ${previewArray(p.value)}.`);
      }
      return step('Инициализация: структура обновлена.');
    }
    if (kind === 'pivotAuto') {
      const pivotVal = valueText(p.value);
      return step(`Опорный элемент (pivot): выбрано значение ${pivotVal}.`);
    }
    if (kind === 'pivotChosen') {
      const pivotVal = valueText(p.value);
      return step(`Опорный элемент (pivot): выбираем значение ${pivotVal}.`);
    }
    if (kind === 'mark') {
      return step(`Выделение: ${elemText(p.value)} — "${tagText(p.tag)}".`);
    }
    if (kind === 'unmark') {
      return step(`Снятие выделения: ${elemText(p.value)}, метка "${tagText(p.tag)}".`);
    }
    if (kind === 'clearMarks') {
      return p.tag
        ? step(`Снятие выделений: убираем метку "${tagText(p.tag)}" у всех элементов.`)
        : step('Снятие выделений: очищаем все метки элементов.');
    }
    if (kind === 'range') {
      const rangeName = p.name ? String(p.name) : 'диапазон';
      if (hasNum(p.leftValue) || hasNum(p.rightValue)) {
        return step(`Диапазон "${rangeName}": от ${elemText(p.leftValue)} до ${elemText(p.rightValue)}.`);
      }
      return step(`Диапазон "${rangeName}": обновлён.`);
    }
    if (kind === 'rangeClear') {
      const rangeName = p.name ? String(p.name) : 'диапазон';
      return step(`Очистка диапазона "${rangeName}".`);
    }
    if (kind === 'clearRanges') {
      return step('Очистка: удаляем все диапазоны.');
    }
    if (kind === 'ptr') {
      const name = p.name ? String(p.name) : 'ptr';
      if (hasNum(p.value)) return step(`Указатель "${name}": указывает на ${elemText(p.value)}.`);
      return step(`Указатель "${name}": позиция обновлена.`);
    }
    if (kind === 'ptrClear') {
      const name = p.name ? String(p.name) : 'ptr';
      return step(`Указатель "${name}": скрываем.`);
    }
    if (kind === 'graphInit') {
      return step(`Подготовка графа: старт "${p.start}", финиш "${p.end}".`);
    }
    if (kind === 'node') {
      return step(`Вершина "${p.id}": ${nodeStateText(p.state)}.`);
    }
    if (kind === 'edge') {
      return step(`Ребро "${p.from}" -> "${p.to}": ${edgeStateText(p.state)}.`);
    }
    if (kind === 'path') {
      if (Array.isArray(p.nodes) && p.nodes.length) {
        return step(`Путь найден: ${p.nodes.join(' -> ')}.`);
      }
      return step('Путь найден.');
    }
    if (kind === 'notFound') {
      return step('Поиск завершён: результат не найден.');
    }
    if (kind === 'binaryInit') {
      return step(`Бинарный поиск: начинаем, длина массива ${p.length}, цель ${p.target}.`);
    }
    if (kind === 'binaryClear') {
      return step('Бинарный поиск: завершаем и очищаем служебные указатели.');
    }
    if (kind === 'note') {
      const text = String(p.text || '').trim();
      const swapNoop = text.match(/^swap\s+noop\s+i=j=(\d+)$/i);
      if (swapNoop) {
        return step(`Обмен пропущен: выбран один и тот же индекс ${swapNoop[1]}, массив не меняется.`);
      }
      return step(`Комментарий: ${text || 'шаг без текста'}.`);
    }

    return step(`Шаг "${kind}".`);
  }

  function stepPayloadKind(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    return p.kind ? String(p.kind) : '';
  }

  function isHiddenStepBase(payload) {
    const kind = stepPayloadKind(payload);
    if (kind === 'range' || kind === 'rangeClear' || kind === 'clearRanges') return true;
    if (kind === 'ptr') {
      const p = payload && typeof payload === 'object' ? payload : {};
      const name = String(p.name || '').trim().toLowerCase();
      if (name === 'mid') return true;
    }
    if (timelineAlgo === 'binary' && kind === 'compare') {
      const p = payload && typeof payload === 'object' ? payload : {};
      if (p.i === -1 || p.j === -1) return true;
    }
    return false;
  }

  function isBinaryStepListKindAllowed(kind) {
    return kind === 'setArray' || kind === 'binaryInit' || kind === 'read' || kind === 'compareEx';
  }

  function getBinaryComparedIndex(payload) {
    if (!payload || stepPayloadKind(payload) !== 'compareEx') return null;
    const i = Number.isInteger(payload.i) ? payload.i : null;
    const j = Number.isInteger(payload.j) ? payload.j : null;
    if (i !== null && i >= 0 && j === -1) return i;
    if (j !== null && j >= 0 && i === -1) return j;
    return null;
  }

  function invalidateBinaryStepListFilterCache() {
    binaryStepListFilterCacheVersion = -1;
    binaryStepListFilterCacheAlgo = '';
    binaryStepListHiddenRaw = new Set();
  }

  function ensureBinaryStepListHiddenRaw() {
    if (timelineAlgo !== 'binary') return;
    if (
      binaryStepListFilterCacheVersion === timelineDataVersion &&
      binaryStepListFilterCacheAlgo === timelineAlgo
    ) {
      return;
    }

    const hidden = new Set();
    const allowed = [];

    for (let rawIndex = 0; rawIndex < timelineStepItems.length; rawIndex++) {
      const item = timelineStepItems[rawIndex];
      const payload = item && item.payload ? item.payload : null;
      const kind = stepPayloadKind(payload);
      if (!isBinaryStepListKindAllowed(kind)) {
        hidden.add(rawIndex);
        continue;
      }
      allowed.push({ rawIndex, kind, payload });
    }

    // Hide duplicate pair:
    // read(mid) -> compareEx(== false) -> read(mid) -> compareEx(<|>)
    for (let idx = 0; idx <= allowed.length - 4; idx++) {
      const a = allowed[idx];
      const b = allowed[idx + 1];
      const c = allowed[idx + 2];
      const d = allowed[idx + 3];

      if (a.kind !== 'read' || b.kind !== 'compareEx' || c.kind !== 'read' || d.kind !== 'compareEx') continue;

      const readA = Number.isInteger(a.payload && a.payload.i) ? a.payload.i : null;
      const readC = Number.isInteger(c.payload && c.payload.i) ? c.payload.i : null;
      const cmpB = getBinaryComparedIndex(b.payload);
      const cmpD = getBinaryComparedIndex(d.payload);
      const bOp = String((b.payload && b.payload.op) || '').trim();
      const dOp = String((d.payload && d.payload.op) || '').trim();
      const bResultFalse = b.payload && b.payload.result === false;
      const dIsDirectionCompare = dOp === '<' || dOp === '>' || dOp === '<=' || dOp === '>=';

      if (
        readA === null ||
        readC === null ||
        cmpB === null ||
        cmpD === null ||
        bOp !== '==' ||
        !bResultFalse ||
        !dIsDirectionCompare
      ) {
        continue;
      }

      if (readA === readC && readA === cmpB && readA === cmpD) {
        hidden.add(a.rawIndex);
        hidden.add(b.rawIndex);
      }
    }

    binaryStepListHiddenRaw = hidden;
    binaryStepListFilterCacheVersion = timelineDataVersion;
    binaryStepListFilterCacheAlgo = timelineAlgo;
  }

  function isHiddenStepForTimeline(payload, rawIndex = -1) {
    if (timelineAlgo === 'binary') {
      ensureBinaryStepListHiddenRaw();
      if (Number.isInteger(rawIndex) && rawIndex >= 0) {
        return binaryStepListHiddenRaw.has(rawIndex);
      }
      return !isBinaryStepListKindAllowed(stepPayloadKind(payload));
    }
    return isHiddenStepBase(payload);
  }

  function setStepListAutoFollow(enabled) {
    stepListAutoFollow = !!enabled;
    if (stepList) {
      stepList.classList.toggle('is-autofollow-paused', !stepListAutoFollow);
    }
  }

  function markStepListProgrammaticScroll() {
    stepListProgrammaticScroll = true;
    if (stepListProgrammaticTimer) clearTimeout(stepListProgrammaticTimer);
    stepListProgrammaticTimer = setTimeout(() => {
      stepListProgrammaticScroll = false;
      stepListProgrammaticTimer = null;
    }, 60);
  }

  function isStepListNearBottom() {
    if (!stepList) return true;
    const threshold = 10;
    return stepList.scrollTop + stepList.clientHeight >= stepList.scrollHeight - threshold;
  }

  function scrollStepListToActive(activeEl) {
    if (!stepList || !activeEl || !stepListAutoFollow) return;

    const viewTop = stepList.scrollTop;
    const viewBottom = viewTop + stepList.clientHeight;
    const itemTop = activeEl.offsetTop;
    const itemBottom = itemTop + activeEl.offsetHeight;

    if (itemTop >= viewTop + 8 && itemBottom <= viewBottom - 8) return;

    const desiredTop = Math.max(0, itemTop - Math.floor(stepList.clientHeight * 0.35));
    markStepListProgrammaticScroll();
    stepList.scrollTo({ top: desiredTop, behavior: 'auto' });
  }

  function renderStepCorner() {
    if (!stepCornerEls.length) return;

    const total = timelineStepItems.reduce((acc, item, idx) => acc + (isHiddenStepForTimeline(item.payload, idx) ? 0 : 1), 0);
    const cursorBound = Math.max(0, Math.min(timelineStepItems.length, timelineCursor));
    const current = timelineStepItems
      .slice(0, cursorBound)
      .reduce((acc, item, idx) => acc + (isHiddenStepForTimeline(item.payload, idx) ? 0 : 1), 0);

    stepCornerEls.forEach((box) => {
      const curEl = box.querySelector('[data-viz-step-current]');
      const totalEl = box.querySelector('[data-viz-step-total]');
      const listEl = box.querySelector('[data-viz-step-list]');

      if (curEl) curEl.textContent = String(current);
      if (totalEl) totalEl.textContent = String(total);
      if (!listEl) return;

      listEl.innerHTML = '';
      if (total === 0) {
        listEl.textContent = 'Нет шагов';
        return;
      }

      if (current <= 0) {
        listEl.textContent = 'Ожидание старта анимации';
        return;
      }

      let activeRaw = cursorBound - 1;
      while (activeRaw >= 0 && isHiddenStepForTimeline(timelineStepItems[activeRaw] && timelineStepItems[activeRaw].payload, activeRaw)) {
        activeRaw--;
      }
      if (activeRaw < 0) {
        listEl.textContent = 'Ожидание старта анимации';
        return;
      }
      const row = document.createElement('div');
      row.className = 'viz-steps-corner-item is-active';
      row.textContent = formatStepLabel(timelineStepItems[activeRaw].payload, current);
      listEl.appendChild(row);
    });
  }

  function refreshStepCursorUi() {
    const visibleCurrent = timelineStepItems
      .slice(0, Math.max(0, timelineCursor))
      .reduce((acc, item, idx) => acc + (isHiddenStepForTimeline(item.payload, idx) ? 0 : 1), 0);
    if (stepCurrentEl) stepCurrentEl.textContent = String(visibleCurrent);
    if (stepRange) stepRange.value = String(timelineCursor);
    if (stepList) {
      const prev = stepList.querySelector('.step-item.is-active');
      if (prev) prev.classList.remove('is-active');
      let activeRaw = Math.max(0, Math.min(timelineStepItems.length, timelineCursor)) - 1;
      while (activeRaw >= 0 && isHiddenStepForTimeline(timelineStepItems[activeRaw] && timelineStepItems[activeRaw].payload, activeRaw)) {
        activeRaw--;
      }
      const active = activeRaw >= 0
        ? stepList.querySelector(`[data-step-raw-index="${activeRaw}"]`)
        : null;
      if (active) {
        active.classList.add('is-active');
        scrollStepListToActive(active);
      }
    }
    renderStepCorner();
  }

  function renderStepTimeline() {
    const total = timelineStepItems.length;
    const visibleTotal = timelineStepItems.reduce((acc, item, idx) => acc + (isHiddenStepForTimeline(item.payload, idx) ? 0 : 1), 0);
    if (stepTotalEl) stepTotalEl.textContent = String(visibleTotal);
    if (stepRange) {
      stepRange.min = '0';
      stepRange.max = String(total);
      stepRange.value = String(Math.min(timelineCursor, total));
      stepRange.disabled = total === 0;
    }
    if (!stepList) return;
    stepList.innerHTML = '';
    if (total === 0) return;
    const frag = document.createDocumentFragment();
    let visibleIdx = 0;
    for (let i = 0; i < total; i++) {
      const payload = timelineStepItems[i] && timelineStepItems[i].payload;
      if (isHiddenStepForTimeline(payload, i)) continue;
      const btn = document.createElement('button');
      const idx = ++visibleIdx;
      btn.type = 'button';
      btn.className = 'step-item';
      btn.dataset.stepIndex = String(i + 1);
      btn.dataset.stepRawIndex = String(i);
      btn.textContent = formatStepLabel(payload, idx);
      frag.appendChild(btn);
    }
    stepList.appendChild(frag);
    renderStepCorner();
  }

  function resetVisualizationToTimelineStart() {
    const isGraph = timelineAlgo === 'bfs' || timelineAlgo === 'dfs';
    if (isGraph) {
      if (window.GraphEditor && window.GraphEditor.clearStates) {
        window.GraphEditor.clearStates();
      }
      return;
    }
    if (window.VizScene && window.VizScene.setCurrentArray) {
      window.VizScene.setCurrentArray(Array.isArray(timelineInitialArray) ? timelineInitialArray.slice() : []);
    } else if (window.setCurrentArray) {
      window.setCurrentArray(Array.isArray(timelineInitialArray) ? timelineInitialArray.slice() : []);
    }
  }

  function processPlaybackItem(item, options = {}) {
    const seeking = !!options.seeking;
    if (!item) return;
    if (item.type === 'step') {
      const p = item.payload && item.payload.payload ? item.payload.payload : item.payload;
      let extraDelay = null;
      try { extraDelay = window.handleStepEvent && window.handleStepEvent(p); } catch {}
      if (!seeking && !timelineUiFrozen) {
        timelineCursor = Math.min(timelineStepItems.length, timelineCursor + 1);
        refreshStepCursorUi();
      }
      if (p && p.kind === 'swap') {
        const ms = (window.VizScene && typeof VizScene.getSwapDelayMs === 'function')
          ? VizScene.getSwapDelayMs()
          : 700;
        if (Number.isFinite(extraDelay)) return Math.max(ms, extraDelay);
        return ms;
      }
      if (Number.isFinite(extraDelay)) return extraDelay;
      return;
    }
    if (!seeking && item.type === 'stderr' && typeof item.payload === 'string') {
      log('[stderr] ' + item.payload);
    }
  }

  const player = new LogPlayer((item) => processPlaybackItem(item));
  let tailFinalizeTimer = null;

  function finalizeTailVisualStateIfNeeded(delayMs = 0) {
    if (suppressTailFinalize) return;
    if (timelineFinalState !== 'Completed') return;
    if (!window.VizScene) return;

    if (tailFinalizeTimer !== null) {
      clearTimeout(tailFinalizeTimer);
      tailFinalizeTimer = null;
    }

    const runFinalize = () => {
      if (suppressTailFinalize) return;
      if (timelineFinalState !== 'Completed') return;
      if (!window.VizScene) return;
      const finalizers = {
        insertion: 'forceCompleteAllInsertions',
        selection: 'forceCompleteSelectionSort',
        quick: 'forceCompleteQuickSort'
      };
      const fnName = finalizers[timelineAlgo];
      if (!fnName) return;
      const fn = window.VizScene[fnName];
      if (typeof fn === 'function') {
        fn();
      }
    };

    const wait = Math.max(0, Number.isFinite(delayMs) ? Math.round(delayMs) : 0);
    if (wait > 0) {
      tailFinalizeTimer = setTimeout(() => {
        tailFinalizeTimer = null;
        runFinalize();
      }, wait);
      return;
    }

    runFinalize();
  }

  function updatePlayPauseLabel(playing) {
    if (!btnPlayPause) return;
    btnPlayPause.textContent = playing ? 'Пауза' : 'Воспроизвести';
    if (!playing && player.queue && player.queue.length === 0) {
      finalizeTailVisualStateIfNeeded(player.lastItemVisualMs);
    }
  }
  player.onStateChange = updatePlayPauseLabel;
  updatePlayPauseLabel(false);

  function rebuildQueueFromCursor() {
    if (!timelineStepItems.length) {
      player.setQueue([], 0);
      return;
    }
    const rest = timelineStepItems.slice(timelineCursor);
    player.setQueue(rest, timelineCursor);
  }

  function seekToStep(stepIndex) {
    const total = timelineStepItems.length;
    const next = Math.max(0, Math.min(total, Number.isFinite(stepIndex) ? Math.floor(stepIndex) : 0));
    suppressTailFinalize = true;
    try {
      player.pause();
      updatePlaybackState(false);
      resetVisualizationToTimelineStart();
    } finally {
      suppressTailFinalize = false;
      if (tailFinalizeTimer !== null) {
        clearTimeout(tailFinalizeTimer);
        tailFinalizeTimer = null;
      }
    }
    timelineUiFrozen = true;
    try {
      if (window.VizScene && window.VizScene.setSeekMode) window.VizScene.setSeekMode(true);
      if (window.VizScene && window.VizScene.setAnimationSpeed) window.VizScene.setAnimationSpeed(1000);
      if (window.VizScene && window.VizScene.setHighlightDuration) window.VizScene.setHighlightDuration(1);
      if (window.VizScene && window.VizScene.setBaseDelay) window.VizScene.setBaseDelay(0);
      for (let i = 0; i < next; i++) {
        processPlaybackItem(timelineStepItems[i], { seeking: true });
      }
    } finally {
      if (window.VizScene && window.VizScene.setSeekMode) window.VizScene.setSeekMode(false);
      timelineUiFrozen = false;
      applySpeedConfig();
    }
    timelineCursor = next;
    refreshStepCursorUi();
    rebuildQueueFromCursor();
    if (next >= total) {
      finalizeTailVisualStateIfNeeded();
    }
  }

  function clearTimeline() {
    timelineStepItems = [];
    timelineInitialArray = [];
    timelineAlgo = getAlgoKey();
    timelineFinalState = null;
    timelineCursor = 0;
    timelineDataVersion++;
    invalidateBinaryStepListFilterCache();
    setStepListAutoFollow(true);
    suppressTailFinalize = true;
    try {
      player.stop();
      updatePlaybackState(false);
    } finally {
      suppressTailFinalize = false;
      if (tailFinalizeTimer !== null) {
        clearTimeout(tailFinalizeTimer);
        tailFinalizeTimer = null;
      }
    }
    renderStepTimeline();
    refreshStepCursorUi();
  }

  function loadTimeline(stepPayloads, initialArray, algoName, finalState) {
    timelineStepItems = (stepPayloads || []).map(p => ({ type: 'step', payload: p }));
    timelineInitialArray = Array.isArray(initialArray) ? initialArray.slice() : [];
    timelineAlgo = algoName || getAlgoKey();
    timelineFinalState = normalizeStage(finalState);
    timelineCursor = 0;
    timelineDataVersion++;
    invalidateBinaryStepListFilterCache();
    setStepListAutoFollow(true);
    renderStepTimeline();
    refreshStepCursorUi();
    resetVisualizationToTimelineStart();
    rebuildQueueFromCursor();
  }

  function replayTimeline() {
    if (!timelineStepItems.length) return;
    seekToStep(0);
    player.play();
    updatePlaybackState(true);
  }

  // Keep viz playback state in sync with the player
  function updatePlaybackState(playing) {
    updatePlayPauseLabel(!!playing);
    if (window.VizScene && window.VizScene.setPlaybackState) {
      window.VizScene.setPlaybackState(playing);
    }
  }

  // Playback controls
  btnPlayPause && btnPlayPause.addEventListener('click', () => {
    if (player.isPlaying) {
      player.pause();
      updatePlaybackState(false);
      return;
    }
    player.play();
    updatePlaybackState(player.isPlaying);
  });
  
  btnReset && btnReset.addEventListener('click', () => { 
    if (timelineStepItems.length) {
      seekToStep(0);
      return;
    }
    suppressTailFinalize = true;
    try {
      player.stop();
      updatePlaybackState(false);
    } finally {
      suppressTailFinalize = false;
      if (tailFinalizeTimer !== null) {
        clearTimeout(tailFinalizeTimer);
        tailFinalizeTimer = null;
      }
    }
    // Reset visualization to the initial array
    if (window.VizScene && window.VizScene.setCurrentArray) {
      const initialArray = window.getCurrentArray ? window.getCurrentArray() : [];
      window.VizScene.setCurrentArray(initialArray);
    }
  });

  btnReplay && btnReplay.addEventListener('click', () => {
    replayTimeline();
  });

  btnStep && btnStep.addEventListener('click', () => {
    player.stepOnce();
    if (!player.isPlaying && player.queue && player.queue.length === 0) {
      finalizeTailVisualStateIfNeeded();
    }
  });
  inpSpeedSwap && inpSpeedSwap.addEventListener('input', () => {
    applySpeedConfig(false);
  });
  inpSpeedOther && inpSpeedOther.addEventListener('input', () => {
    const rawText = (typeof inpSpeedOther.value === 'string') ? inpSpeedOther.value.trim() : '';
    if (!rawText) {
      // Allow the user to fully clear the field while editing.
      // Validation is enforced on Run (strict mode).
      return;
    }
    const rawOther = parseSpeedInput(inpSpeedOther);
    if (Number.isFinite(rawOther) && rawOther > 0) {
      syncDetailSpeedsFromOther();
      applySpeedConfig(false);
      return;
    }
    if (isOtherCustomValue(rawText)) {
      applySpeedConfig(false);
    }
  });
  [inpSpeedCompare, inpSpeedRead, inpSpeedWrite, inpSpeedMove, inpSpeedSet, inpSpeedRange].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      setOtherSpeedCustom();
      applySpeedConfig(false);
    });
  });
  btnSpeedDetails && btnSpeedDetails.addEventListener('click', () => {
    toggleSpeedDetails();
  });
  stepRange && stepRange.addEventListener('input', () => {
    const next = parseInt(stepRange.value || '0', 10);
    seekToStep(Number.isFinite(next) ? next : 0);
  });
  stepList && stepList.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-step-index]') : null;
    if (!btn) return;
    const next = parseInt(btn.dataset.stepIndex || '0', 10);
    seekToStep(Number.isFinite(next) ? next : 0);
  });
  if (stepList) {
    const disableAutoFollow = () => {
      if (stepListProgrammaticScroll) return;
      setStepListAutoFollow(false);
    };

    stepList.addEventListener('wheel', disableAutoFollow, { passive: true });
    stepList.addEventListener('touchmove', disableAutoFollow, { passive: true });
    stepList.addEventListener('focusout', disableAutoFollow);
    stepList.addEventListener('scroll', () => {
      if (stepListProgrammaticScroll) return;
      if (isStepListNearBottom()) {
        setStepListAutoFollow(true);
      } else {
        setStepListAutoFollow(false);
      }
    }, { passive: true });
  }
  setStepListAutoFollow(true);
  (function initSpeedControls(){
    if (inpSpeedSwap) inpSpeedSwap.value = String(DEFAULT_SWAP_MS);
    if (inpSpeedOther) inpSpeedOther.value = String(DEFAULT_OTHER_MS);
    [inpSpeedCompare, inpSpeedRead, inpSpeedWrite, inpSpeedMove, inpSpeedSet, inpSpeedRange].forEach(el => {
      if (el) el.value = String(DEFAULT_OTHER_MS);
    });
    toggleSpeedDetails(false);
    applySpeedConfig(true);
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

  function parseStepPayloads(output, algoName) {
    const steps = [];
    const algoKey = String(algoName || '').toLowerCase();
    const isQuick = algoKey === 'quick';
    const isInsertion = algoKey === 'insertion';
    const recentReads = [];
    let lastPivotValue = null;
    let lastPivotIndex = null;
    let insertionPendingSetIndex = null;
    let insertionPendingSetValue = null;

    function isInsertionConstCompare(step) {
      if (!step || step.kind !== 'compareEx') return false;
      if (String(step.op || '').trim() !== '>') return false;
      const iNum = Number.isInteger(step.i) && step.i >= 0;
      const jNum = Number.isInteger(step.j) && step.j >= 0;
      return (iNum && step.j === -1) || (jNum && step.i === -1);
    }

    function insertionCompareIndex(step) {
      if (Number.isInteger(step.i) && step.i >= 0 && step.j === -1) return step.i;
      if (Number.isInteger(step.j) && step.j >= 0 && step.i === -1) return step.j;
      return null;
    }

    function insertionKeyValue(step) {
      if (Number.isInteger(step.i) && step.i >= 0 && step.j === -1) return step.bj;
      if (Number.isInteger(step.j) && step.j >= 0 && step.i === -1) return step.ai;
      return null;
    }

    function parseInnerStep(rawLine) {
      if (!rawLine) return null;
      if (rawLine.startsWith('__STEP__')) {
        const json = rawLine.slice('__STEP__'.length);
        const parsed = JSON.parse(json);
        return parsed && parsed.payload ? parsed.payload : parsed;
      }
      const env = tryParseEnvelope(rawLine);
      if (env && env.type === 'step' && env.payload && typeof env.payload === 'object') {
        return env.payload;
      }
      return null;
    }

    function extractQuickCompareInfo(step) {
      if (!step || step.kind !== 'compareEx') return null;
      const leftIsConst = step.i === -1;
      const rightIsConst = step.j === -1;
      if (!leftIsConst && !rightIsConst) return null;
      if (leftIsConst === rightIsConst) return null;
      return {
        comparedIndex: leftIsConst ? step.j : step.i,
        constValue: leftIsConst ? step.ai : step.bj
      };
    }

    function inferPivotIndex(constValue, comparedIndex) {
      for (let i = recentReads.length - 1; i >= 0; i--) {
        const r = recentReads[i];
        if (r.value !== constValue) continue;
        if (!Number.isInteger(comparedIndex) || r.index !== comparedIndex) return r.index;
      }
      for (let i = recentReads.length - 1; i >= 0; i--) {
        const r = recentReads[i];
        if (r.value === constValue) return r.index;
      }
      return null;
    }

    function pushStep(step) {
      if (!step || typeof step !== 'object') return;

      if (isInsertion) {
        // Auto insertion sort shows shifts and writes, so raw technical
        // compare/swap records would only duplicate the visible sequence.
        if (step.kind === 'compare' && (step.i === -1 || step.j === -1)) {
          return;
        }
        if (step.kind === 'swap') {
          return;
        }
        if (step.kind === 'setArray') {
          insertionPendingSetIndex = null;
          insertionPendingSetValue = null;
        }
        if (isInsertionConstCompare(step)) {
          const cmpIndex = insertionCompareIndex(step);
          const keyValue = insertionKeyValue(step);
          if (Number.isInteger(cmpIndex) && Number.isFinite(keyValue)) {
            if (step.result === false) {
              insertionPendingSetIndex = cmpIndex + 1;
              insertionPendingSetValue = keyValue;
            } else if (step.result === true && cmpIndex === 0) {
              // j becomes -1 after shift from index 0, next expected write is key at index 0.
              insertionPendingSetIndex = 0;
              insertionPendingSetValue = keyValue;
            }
          }
        }
        if (step.kind === 'set' && Number.isInteger(step.i) && Number.isFinite(step.value)) {
          if (Number.isInteger(insertionPendingSetIndex) && step.i === insertionPendingSetIndex) {
            insertionPendingSetIndex = null;
            insertionPendingSetValue = null;
          }
        }
      }

      if (isQuick) {
        // For quick-sort with constant pivot comparisons, keep compareEx only.
        // The plain compare step is technical and has no separate animation.
        if (step.kind === 'compare' && (step.i === -1 || step.j === -1)) {
          return;
        }

        if (step.kind === 'setArray') {
          recentReads.length = 0;
          lastPivotValue = null;
          lastPivotIndex = null;
        }

        if (step.kind === 'read' && Number.isInteger(step.i)) {
          recentReads.push({ index: step.i, value: step.value });
          if (recentReads.length > 12) recentReads.shift();
        }

        const compareInfo = extractQuickCompareInfo(step);
        if (compareInfo) {
          const constValue = compareInfo.constValue;
          const pivotIndex = inferPivotIndex(constValue, compareInfo.comparedIndex);
          const pivotChanged =
            constValue !== lastPivotValue ||
            (Number.isInteger(pivotIndex) && pivotIndex !== lastPivotIndex);

          if (pivotChanged) {
            steps.push({
              kind: 'pivotAuto',
              index: Number.isInteger(pivotIndex) ? pivotIndex : null,
              value: constValue
            });
            lastPivotValue = constValue;
            if (Number.isInteger(pivotIndex)) lastPivotIndex = pivotIndex;
          }
        }
      }

      steps.push(step);
    }

    const lines = String(output || '').split(/\r?\n/);
    for (const line of lines) {
      if (!line) continue;
      try {
        const inner = parseInnerStep(line);
        pushStep(inner);
      } catch {
        log('[stderr] STEP parse error');
      }
    }

    if (
      isInsertion &&
      Number.isInteger(insertionPendingSetIndex) &&
      insertionPendingSetIndex >= 0 &&
      Number.isFinite(insertionPendingSetValue)
    ) {
      steps.push({
        kind: 'set',
        i: insertionPendingSetIndex,
        value: insertionPendingSetValue,
        synthetic: true
      });
    }

    return steps;
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
          if (s && (s.state === 'Completed' || s.state === 'Failed' || s.state === 'Cancelled')) {
            stopTimer();
            return s;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  async function requestServerCancel(runToken) {
    if (!runToken || !runToken.submissionId) return false;
    try {
      const cancelUrl = `${runnerBase}/api/submissions/${runToken.submissionId}/cancel`;
      const res = await fetch(cancelUrl, { method: 'POST' });
      if (!res.ok) {
        log(`HTTP ${res.status}: failed to cancel`);
        return false;
      }
      return true;
    } catch (err) {
      log('[cancel error] ' + (err && err.message ? err.message : String(err)));
      return false;
    }
  }

  const btnStop = document.getElementById('stop');
  btnStop && btnStop.addEventListener('click', async () => {
    const token = currentRunToken;
    if (!token) return;
    token.cancelled = true;
    log('[cancel requested]');
    const cancelled = await requestServerCancel(token);
    if (cancelled) {
      log('[cancel accepted]');
    }
    setStatus('Cancelled');
    stopTimer();
  });

  document.getElementById('run').addEventListener('click', async () => {
    if (!editor) return;
    if (!applySpeedConfig(true)) return;

    if (currentRunToken) currentRunToken.cancelled = true;
    const token = { cancelled: false, submissionId: null };
    currentRunToken = token;

    const algoName = getAlgoKey();
    if (!validateBeforeRun(algoName)) return;
    setStatus('Submitting');
    resetStageDurations();
    startTimer();
    const codeFromEditor = editor.getValue();
    const pageArray = window.getCurrentArray ? window.getCurrentArray() : [];
    const sourceToSend = buildSourceForRun(codeFromEditor, pageArray, algoName);
    const inputPayload = buildInputPayload(algoName);

    if (consoleEl) consoleEl.textContent = '';
    clearTimeline();
    rawLogExport.reset(algoName);

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
      token.submissionId = id;
      const statusUrl = created.statusUrl
        ? (created.statusUrl.startsWith('http')
          ? created.statusUrl
          : `${runnerBase}${created.statusUrl.startsWith('/') ? '' : '/'}${created.statusUrl}`)
        : `${runnerBase}/api/submissions/${id}/status`;

      log('[queued]');
      setStatus('Queued');
      handleStatusStage('Queued');

      const finalStatus = await pollStatus(statusUrl, token);
      if (token.cancelled) return;
      if (finalStatus && finalStatus.state === 'Cancelled') {
        stopTimer();
        return;
      }

      const resultUrl = `${runnerBase}/api/submissions/${id}`;
      const resultRes = await fetch(resultUrl, { cache: 'no-store' });
      if (!resultRes.ok) {
        log(`HTTP ${resultRes.status}: failed to fetch result`);
        setStatus('Error');
        stopTimer();
        return;
      }

      const result = await resultRes.json();
      rawLogExport.remember(result && typeof result.output === 'string' ? result.output : '', id, algoName);
      if (result && result.error) {
        log('[stderr] ' + result.error);
      }
      const stepPayloads = parseStepPayloads(result && result.output ? result.output : '', algoName);

      const activeAlgo = getAlgoKey();
      if (activeAlgo !== algoName) {
        log(`[info] Результат "${algoName}" получен, но сейчас открыта вкладка "${activeAlgo}". Шаги не перенесены.`);
        stopTimer();
        return;
      }

      loadTimeline(stepPayloads, pageArray, algoName, finalStatus ? finalStatus.state : null);

      const auto = chkAutoplay ? !!chkAutoplay.checked : true;
      if (auto && stepPayloads.length) {
        player.play();
        updatePlaybackState(true);
      }
      stopTimer();
    } catch (err) {
      log('Run error: ' + (err && err.message ? err.message : String(err)));
      setStatus('Error');
      stopTimer();
    }
  });

  rawLogExport.reset(getAlgoKey());
  clearTimeline();
  setStatus('Idle');
})();
