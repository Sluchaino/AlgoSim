namespace AlgoTracing
{
    public sealed class TrackedVisited
    {
        private readonly bool[] _visited;
        private readonly TrackedAdjacencyList _graph;

        public TrackedVisited(int size, TrackedAdjacencyList graph)
        {
            _visited = size > 0 ? new bool[size] : new bool[0];
            _graph = graph;
        }

        public bool this[int index]
        {
            get => _visited[index];
            set
            {
                _visited[index] = value;
                if (value)
                {
                    _graph.MarkVisited(index);
                }
            }
        }
    }
}
