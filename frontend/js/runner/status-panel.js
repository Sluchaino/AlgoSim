(function () {
  const statusBox = document.getElementById('run-status');
  const statusText = document.getElementById('run-status-text');
  const timerEl = document.getElementById('run-timer');
  const toggleBtn = document.getElementById('run-status-toggle');
  const stageTimeEls = {};
  const stageStepEls = {};
  const STAGES = ['Queued', 'CompileQueued', 'Compiling', 'RunQueued', 'Running', 'Completed', 'Failed', 'Cancelled'];
  const STATUS_LABELS_RU = {
    Idle: 'Ожидание',
    Submitting: 'Отправка',
    Queued: 'В очереди',
    CompileQueued: 'Ожидание компилятора',
    Compiling: 'Компиляция',
    RunQueued: 'Ожидание запуска',
    Running: 'Выполнение',
    Retrying: 'Повторная попытка',
    Completed: 'Выполнено',
    Failed: 'Ошибка',
    Cancelled: 'Отменено',
    Error: 'Ошибка'
  };

  let timerId = null;
  let timerStart = null;
  let currentStage = null;
  let stageStart = null;
  const stageDurations = new Map();
  const stageSeen = new Set();
  let isCollapsed = false;

  document.querySelectorAll('[data-stage-time]').forEach(el => {
    stageTimeEls[el.dataset.stageTime] = el;
  });
  document.querySelectorAll('[data-stage]').forEach(el => {
    stageStepEls[el.dataset.stage] = el;
  });

  function normalizeStage(stage) {
    const raw = String(stage || '').trim();
    const lower = raw.toLowerCase();
    if (lower === 'queued') return 'Queued';
    if (lower === 'compilequeued' || lower === 'compile_queued' || lower === 'compile-queued') return 'CompileQueued';
    if (lower === 'compiling') return 'Compiling';
    if (lower === 'runqueued' || lower === 'run_queued' || lower === 'run-queued') return 'RunQueued';
    if (lower === 'running') return 'Running';
    if (lower === 'retrying') return 'Retrying';
    if (lower === 'completed') return 'Completed';
    if (lower === 'failed') return 'Failed';
    if (lower === 'cancelled') return 'Cancelled';
    return raw;
  }

  function setStatus(text) {
    const raw = text || 'Idle';
    const normalized = normalizeStage(raw) || raw;
    const label = STATUS_LABELS_RU[normalized] || STATUS_LABELS_RU[raw] || raw;
    if (statusText) statusText.textContent = label;
    if (statusBox) statusBox.dataset.state = normalized;
  }

  function getFocusStageForCollapsedView() {
    if (currentStage && STAGES.includes(currentStage)) return currentStage;

    for (const stage of STAGES) {
      const el = stageStepEls[stage];
      if (el && el.classList.contains('is-active')) return stage;
    }

    for (let i = STAGES.length - 1; i >= 0; i--) {
      const stage = STAGES[i];
      if (stageSeen.has(stage)) return stage;
    }

    return null;
  }

  function refreshCollapsedView() {
    const focusStage = getFocusStageForCollapsedView();

    STAGES.forEach(stage => {
      const el = stageStepEls[stage];
      if (!el) return;
      const hide = isCollapsed && focusStage !== stage;
      el.classList.toggle('is-collapsed-hidden', hide);
    });

    if (statusBox) statusBox.classList.toggle('is-collapsed', isCollapsed);
    if (toggleBtn) {
      toggleBtn.textContent = isCollapsed ? '▸' : '▾';
      toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      toggleBtn.setAttribute(
        'aria-label',
        isCollapsed ? 'Развернуть статус выполнения' : 'Свернуть статус выполнения'
      );
    }
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
    refreshCollapsedView();
  }

  function setActiveStage(stage) {
    Object.values(stageStepEls).forEach(el => el.classList.remove('is-active'));
    const el = stageStepEls[stage];
    if (el) el.classList.add('is-active');
    refreshCollapsedView();
  }

  function showStage(stage) {
    const el = stageStepEls[stage];
    if (!el) return;
    el.classList.remove('is-hidden');
    stageSeen.add(stage);
    refreshCollapsedView();
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
      if (!stageSeen.has(stage)) showStage(stage);
    });
    renderStageDurations();
    refreshCollapsedView();
  }

  function handleStatusStage(state) {
    const s = normalizeStage(state);
    if (!STAGES.includes(s)) return;
    if (s === 'Completed' || s === 'Failed' || s === 'Cancelled') {
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

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      refreshCollapsedView();
    });
  }

  refreshCollapsedView();

  window.RunStatusPanel = {
    normalizeStage,
    setStatus,
    resetStageDurations,
    handleStatusStage,
    startTimer,
    stopTimer
  };
})();
