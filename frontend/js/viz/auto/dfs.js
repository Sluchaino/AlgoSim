// dfs.js - graph animation for DFS
(function () {
  if (!window.VizScene) return;

  function getGraph() {
    return window.GraphEditor || null;
  }

  function resetGraph() {
    const graph = getGraph();
    if (graph && graph.clearStates) graph.clearStates();
  }

  function handleGraphEvent(p) {
    const graph = getGraph();
    if (!graph) return;
    if (!p || typeof p !== 'object') return;

    switch (p.kind) {
      case 'graphInit':
        if (graph.clearStates) graph.clearStates();
        if (p.start) graph.setNodeState && graph.setNodeState(p.start, 'start', true);
        if (p.end) graph.setNodeState && graph.setNodeState(p.end, 'end', true);
        break;
      case 'node':
        if (p.state === 'current') {
          graph.clearNodeStateAll && graph.clearNodeStateAll('current');
          graph.clearNodeState && graph.clearNodeState(p.id, 'frontier');
        }
        graph.setNodeState && graph.setNodeState(p.id, p.state, true);
        break;
      case 'edge':
        graph.clearEdgeStateAll && graph.clearEdgeStateAll('active');
        graph.setEdgeState && graph.setEdgeState(p.from, p.to, p.state || 'active', true);
        break;
      case 'path':
        graph.clearEdgeStateAll && graph.clearEdgeStateAll('active');
        graph.markPath && graph.markPath(p.nodes || []);
        break;
      case 'notFound':
        graph.flashNotFound && graph.flashNotFound();
        break;
      default:
        break;
    }
  }

  window.VizScene.registerAuto('dfs', {
    handle: handleGraphEvent,
    reset: resetGraph
  });

  window.VizScene.registerControlled('dfs', {
    handle: handleGraphEvent,
    reset: resetGraph
  });
})();
