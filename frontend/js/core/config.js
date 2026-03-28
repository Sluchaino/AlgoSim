// /js/config.js - shared runner + visualization config

;(() => {
  // ---------- RUNNER_BASE ----------
  // If window.RUNNER_BASE is already defined, keep it.
  // Otherwise use same-origin. Uncomment localhost for local runner.
  if (typeof window.RUNNER_BASE !== 'string') {
    const isFile = location.protocol === 'file:';
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isLocalNonApiPort = isLocal && location.port && location.port !== '5280';
    window.RUNNER_BASE = (isFile || isLocalNonApiPort) ? 'http://localhost:5280' : '';
  }

  // ---------- GSAP defaults ----------
  if (window.gsap && !window.__GSAP_DEFAULTS_SET__) {
    window.__GSAP_DEFAULTS_SET__ = true;
    gsap.defaults({ overwrite: 'auto', ease: 'power2.inOut' });
  }

  // ---------- Read CSS variables ----------
  const readCssNumber = (name, def) => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : def;
  };

  // ---------- Scene geometry ----------
  window.VizCFG = {
    NS   : 'http://www.w3.org/2000/svg',
    GAP  : readCssNumber('--gap', 14),
    PAD  : readCssNumber('--pad', 16),
    R_MIN: readCssNumber('--r-min', 14),
    R_MAX: readCssNumber('--r-max', 54),
    CY   : 140,
  };

  // ---------- Animation durations (seconds) ----------
  window.VizDUR = {
    pulse: 0.25,
    move : 0.35,
    swap : 0.40,
    set  : 0.25,
    range: 0.20,
  };
})();
