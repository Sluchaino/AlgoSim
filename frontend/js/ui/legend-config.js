// legend-config.js - mapping of legend items per algorithm/mode
(function () {
  window.LEGEND_CONFIG = {
    auto: {
      insertion: ['compare', 'read', 'write', 'key', 'sorted'],
      selection: ['compare', 'read', 'min', 'swap', 'sorted'],
      quick: ['compare', 'read', 'pivot', 'range', 'swap'],
      binary: ['read', 'range', 'mid', 'found']
    },
    controlled: {
      insertion: ['compare', 'read', 'write', 'key', 'sorted'],
      selection: ['compare', 'read', 'min', 'swap', 'sorted'],
      quick: ['compare', 'read', 'pivot', 'range', 'swap'],
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
