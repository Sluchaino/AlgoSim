using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace AlgoTracing
{
    public sealed class TrackedAdjacencyList : IReadOnlyList<TrackedNeighbors>
    {
        private readonly List<List<int>> _adj;
        private readonly List<string> _labels;
        private readonly GraphTracer _g;

        public TrackedAdjacencyList(List<List<int>> adj, List<string> labels, ITracer tracer)
        {
            _adj = adj ?? new List<List<int>>();
            _labels = labels ?? new List<string>();
            _g = new GraphTracer(tracer);
        }

        public int Count => _adj.Count;

        public TrackedNeighbors this[int index] => new TrackedNeighbors(this, index, index >= 0 && index < _adj.Count ? _adj[index] : new List<int>());

        public IEnumerator<TrackedNeighbors> GetEnumerator()
        {
            for (int i = 0; i < Count; i++)
                yield return this[i];
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

        public void GraphInit(string startLabel, string endLabel)
            => _g.GraphInit(startLabel, endLabel);

        public void MarkFrontier(int index)
            => _g.Node(Label(index), "frontier");

        public void MarkCurrent(int index)
            => _g.Node(Label(index), "current");

        public void MarkVisited(int index)
            => _g.Node(Label(index), "visited");

        public void MarkStart(int index)
            => _g.Node(Label(index), "start");

        public void MarkEnd(int index)
            => _g.Node(Label(index), "end");

        public void Path(IEnumerable<int> nodes)
            => _g.Path(nodes.Select(Label));

        public void NotFound()
            => _g.NotFound();

        public string LabelOf(int index) => Label(index);

        internal void TraceEdge(int from, int to)
            => _g.Edge(Label(from), Label(to));

        private string Label(int index)
        {
            if (index >= 0 && index < _labels.Count)
                return _labels[index];
            return index.ToString();
        }
    }

    public sealed class TrackedNeighbors : IEnumerable<int>
    {
        private readonly TrackedAdjacencyList _owner;
        private readonly int _from;
        private readonly List<int> _list;

        public TrackedNeighbors(TrackedAdjacencyList owner, int from, List<int> list)
        {
            _owner = owner;
            _from = from;
            _list = list ?? new List<int>();
        }

        public IEnumerator<int> GetEnumerator()
        {
            foreach (var to in _list)
            {
                _owner.TraceEdge(_from, to);
                yield return to;
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
