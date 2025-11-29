using System;
using System.Linq;
﻿using System.Collections.Generic;

namespace AlgoTracing
{
    public static class TracingExtensions
    {
        public static void EmitArray(this ITracer? t, IEnumerable<int>? list)
        {
            if (t == null) return;
            var arr = (list ?? Array.Empty<int>()).ToArray();
            t.Step(new { kind = "setArray", value = arr });
        }

        // Метки для пояснений
        public static void MarkKey(this ITracer? t, int i) => t?.Mark(i, "key");
        public static void MarkMin(this ITracer? t, int i) => t?.Mark(i, "min");
        public static void MarkPivot(this ITracer? t, int i) => t?.Mark(i, "pivot");
        public static void MarkSorted(this ITracer? t, int i) => t?.Mark(i, "sorted");

        // Диапазоны (подзадачи)
        public static void Range(this ITracer? t, int l, int r, string? tag = null)
            => t?.Step(new { kind = "range", l = Math.Min(l, r), r = Math.Max(l, r), tag });

        public static void ClearRanges(this ITracer t)
            => t?.Step(new { kind = "clearRanges" });
    }
}