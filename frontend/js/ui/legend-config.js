// legend-config.js - mapping of legend items per algorithm/mode
(function () {
  window.LEGEND_CONFIG = {
    auto: {
      insertion: ['compare', 'swap', 'key', 'sorted'],
      selection: ['compare', 'swap', 'min', 'sorted'],
      quick: ['compare', 'swap', 'pivot', 'range', 'read'],
      binary: ['range', 'mid', 'found']
    },
    controlled: {
      insertion: ['compare', 'swap', 'read', 'sorted'],
      selection: ['compare', 'swap', 'read', 'min', 'sorted'],
      quick: ['compare', 'swap', 'read', 'pivot', 'range'],
      binary: ['read', 'range', 'mid', 'found']
    },
    graph: {
      bfs: ['start', 'end', 'frontier', 'visited', 'current', 'path', 'notfound', 'edge-active', 'edge-path', 'edge-notfound'],
      dfs: ['start', 'end', 'frontier', 'visited', 'current', 'path', 'notfound', 'edge-active', 'edge-path', 'edge-notfound']
    },
    sandbox: {
      array: ['compare', 'swap', 'read', 'write', 'key', 'min', 'pivot', 'sorted', 'mid', 'found', 'range'],
      graph: ['start', 'end', 'frontier', 'visited', 'current', 'path', 'notfound', 'edge-active', 'edge-path', 'edge-notfound']
    }
  };
})();
