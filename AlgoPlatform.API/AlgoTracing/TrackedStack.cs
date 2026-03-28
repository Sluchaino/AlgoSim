using System.Collections.Generic;

namespace AlgoTracing
{
    public sealed class TrackedStack
    {
        private readonly Stack<int> _stack = new();
        private readonly TrackedAdjacencyList _graph;

        public TrackedStack(TrackedAdjacencyList graph)
        {
            _graph = graph;
        }

        public int Count => _stack.Count;

        public void Push(int value)
        {
            _stack.Push(value);
            _graph.MarkFrontier(value);
        }

        public int Pop()
        {
            var value = _stack.Pop();
            _graph.MarkCurrent(value);
            return value;
        }
    }
}
