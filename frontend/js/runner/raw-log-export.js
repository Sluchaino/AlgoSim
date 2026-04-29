(function () {
  const btnExportRawLogs = document.getElementById('export-raw-logs');
  let lastServerRawLogs = '';
  let lastServerSubmissionId = null;
  let lastServerAlgo = 'run';
  let logFn = null;

  function setRawExportEnabled(enabled) {
    if (!btnExportRawLogs) return;
    btnExportRawLogs.disabled = !enabled;
  }

  function reset(defaultAlgo) {
    lastServerRawLogs = '';
    lastServerSubmissionId = null;
    lastServerAlgo = defaultAlgo || 'run';
    setRawExportEnabled(false);
  }

  function remember(rawOutput, submissionId, algoKey) {
    if (typeof rawOutput !== 'string' || rawOutput.length === 0) {
      reset(algoKey || 'run');
      return;
    }
    lastServerRawLogs = rawOutput;
    lastServerSubmissionId = submissionId || null;
    lastServerAlgo = (algoKey || 'run').toLowerCase();
    setRawExportEnabled(true);
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function sanitizeFilePart(text) {
    return String(text || '')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'run';
  }

  function bind(log) {
    logFn = typeof log === 'function' ? log : null;
    if (!btnExportRawLogs) return;
    btnExportRawLogs.addEventListener('click', () => {
      if (!lastServerRawLogs) {
        logFn && logFn('[error] Нет raw логов для экспорта. Сначала выполните запуск.');
        return;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const algo = sanitizeFilePart(lastServerAlgo);
      const submission = lastServerSubmissionId ? `submission-${sanitizeFilePart(lastServerSubmissionId)}` : 'submission';
      const fileName = `raw-logs-${algo}-${submission}-${ts}.log`;
      downloadTextFile(fileName, lastServerRawLogs);
      logFn && logFn(`[raw logs] exported: ${fileName}`);
    });
  }

  window.RawLogExport = { bind, reset, remember };
})();
