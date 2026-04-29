// Array panel controls
(function () {
  const parseManual = (str) =>
    (str || "")
      .split(/[\s,;]+/g)
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(v => Number.isFinite(v));

  const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  const shuffled = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const getAlgoKey = () => {
    const key = (window.getCurrentAlgo ? window.getCurrentAlgo() : (location.hash || '').replace('#', '').trim().toLowerCase());
    return key || 'insertion';
  };

  const isBinaryAlgo = () => getAlgoKey() === 'binary';

  const setArr = (arr) => {
    const next = isBinaryAlgo()
      ? (Array.isArray(arr) ? arr.slice().sort((a, b) => a - b) : [])
      : arr;
    return (window.setCurrentArray ? window.setCurrentArray(next) : void 0);
  };

  // Buttons
  const elApply   = document.getElementById('apply');
  const elGen     = document.getElementById('gen');
  const elShuffle = document.getElementById('shuffle');
  const elClear   = document.getElementById('clear');
  const elReset   = document.getElementById('reset-array');
  const elCopy    = document.getElementById('copy-array');

  const toArrayText = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map(v => Number.isFinite(+v) ? Math.trunc(+v) : 0)
      .join(', ');

  const copyTextToClipboard = async (text) => {
    const raw = String(text ?? '');
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(raw);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = raw;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (!ok) throw new Error('Clipboard copy failed');
    return true;
  };

  const pulseButtonText = (btn, text, ms = 1300) => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = prev; }, ms);
  };

  elApply && elApply.addEventListener('click', () => {
    const val = document.getElementById('manual')?.value || '';
    setArr(parseManual(val));
  });

  elGen && elGen.addEventListener('click', () => {
    const n  = Math.min(Math.max(parseInt(document.getElementById('len') ?.value || '0', 10), 1), 200);
    const lo = parseInt(document.getElementById('vmin')?.value || '0', 10);
    const hi = parseInt(document.getElementById('vmax')?.value || '0', 10);
    const L = Math.min(lo, hi), H = Math.max(lo, hi);
    setArr(Array.from({ length: n }, () => randInt(L, H)));
  });

  elShuffle && elShuffle.addEventListener('click', () => {
    const cur = window.getCurrentArray ? window.getCurrentArray() : [];
    if (!cur.length) return;
    setArr(shuffled(cur));
  });

  elClear && elClear.addEventListener('click', () => setArr([]));
  elReset && elReset.addEventListener('click', () => {
    if (window.resetArrayToBase) window.resetArrayToBase();
  });
  elCopy && elCopy.addEventListener('click', async () => {
    const cur = window.getCurrentArray ? window.getCurrentArray() : [];
    if (!Array.isArray(cur) || cur.length === 0) {
      pulseButtonText(elCopy, 'Массив пуст');
      return;
    }
    const text = toArrayText(cur);
    try {
      await copyTextToClipboard(text);
      pulseButtonText(elCopy, 'Скопировано');
    } catch {
      pulseButtonText(elCopy, 'Ошибка копирования');
    }
  });

  window.ensureBinarySorted = () => {
    if (!isBinaryAlgo()) return;
    const cur = window.getCurrentArray ? window.getCurrentArray() : [];
    setArr(cur);
  };
})();

