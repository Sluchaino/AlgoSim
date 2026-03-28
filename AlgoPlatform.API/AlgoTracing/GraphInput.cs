using System;
using System.Collections.Generic;
using System.Text.Json;

namespace AlgoTracing
{
    public static class GraphInput
    {
        public static TrackedAdjacencyList Parse(
            string json,
            ITracer tracer,
            out int startIndex,
            out int endIndex,
            out string startLabel,
            out string endLabel)
        {
            startIndex = -1;
            endIndex = -1;
            startLabel = string.Empty;
            endLabel = string.Empty;

            var labels = new List<string>();
            var index = new Dictionary<string, int>(StringComparer.Ordinal);
            var adjacency = new List<List<int>>();

            if (string.IsNullOrWhiteSpace(json))
            {
                return new TrackedAdjacencyList(adjacency, labels, tracer);
            }

            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.TryGetProperty("selection", out var sel))
                {
                    if (sel.TryGetProperty("start", out var s) && s.ValueKind == JsonValueKind.String)
                        startLabel = s.GetString() ?? string.Empty;
                    if (sel.TryGetProperty("end", out var e) && e.ValueKind == JsonValueKind.String)
                        endLabel = e.GetString() ?? string.Empty;
                }

                if (root.TryGetProperty("graph", out var g) && g.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in g.EnumerateObject())
                    {
                        EnsureLabel(prop.Name, labels, index);
                        if (prop.Value.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var n in prop.Value.EnumerateArray())
                            {
                                if (n.ValueKind == JsonValueKind.String)
                                    EnsureLabel(n.GetString() ?? string.Empty, labels, index);
                            }
                        }
                    }

                    adjacency = new List<List<int>>(labels.Count);
                    for (int i = 0; i < labels.Count; i++) adjacency.Add(new List<int>());

                    foreach (var prop in g.EnumerateObject())
                    {
                        var from = index[prop.Name];
                        if (prop.Value.ValueKind != JsonValueKind.Array) continue;
                        foreach (var n in prop.Value.EnumerateArray())
                        {
                            if (n.ValueKind != JsonValueKind.String) continue;
                            var label = n.GetString() ?? string.Empty;
                            if (!index.TryGetValue(label, out var to)) continue;
                            adjacency[from].Add(to);
                        }
                    }
                }
            }
            catch
            {
                return new TrackedAdjacencyList(adjacency, labels, tracer);
            }

            if (!string.IsNullOrWhiteSpace(startLabel) && index.TryGetValue(startLabel, out var sIdx))
                startIndex = sIdx;
            if (!string.IsNullOrWhiteSpace(endLabel) && index.TryGetValue(endLabel, out var eIdx))
                endIndex = eIdx;

            return new TrackedAdjacencyList(adjacency, labels, tracer);
        }

        private static void EnsureLabel(string label, List<string> labels, Dictionary<string, int> index)
        {
            if (string.IsNullOrWhiteSpace(label)) return;
            if (index.ContainsKey(label)) return;
            index[label] = labels.Count;
            labels.Add(label);
        }
    }
}
