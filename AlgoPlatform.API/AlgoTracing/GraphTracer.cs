using System.Collections.Generic;

namespace AlgoTracing
{
    public sealed class GraphTracer
    {
        private readonly ITracer _t;

        public GraphTracer(ITracer t)
        {
            _t = t;
        }

        public void GraphInit(string start, string end)
            => _t.Step(new { kind = "graphInit", start, end });

        public void Node(string id, string state)
            => _t.Step(new { kind = "node", id, state });

        public void Edge(string from, string to, string state = "active")
            => _t.Step(new { kind = "edge", from, to, state });

        public void Path(IEnumerable<string> nodes)
            => _t.Step(new { kind = "path", nodes });

        public void NotFound()
            => _t.Step(new { kind = "notFound" });
    }
}
