using System.Collections.Generic;

namespace AlgoTracing
{
    public sealed class TrackedQueue
    {
        private readonly Queue<int> _queue = new();
        private readonly TrackedAdjacencyList _graph;

        public TrackedQueue(TrackedAdjacencyList graph)
        {
            _graph = graph;
        }

        public int Count => _queue.Count;

        public void Enqueue(int value)
        {
            _queue.Enqueue(value);
            _graph.MarkFrontier(value);
        }

        public int Dequeue()
        {
            var value = _queue.Dequeue();
            _graph.MarkCurrent(value);
            return value;
        }
    }
}
