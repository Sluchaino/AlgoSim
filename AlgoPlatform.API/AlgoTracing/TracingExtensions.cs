using System;
using System.Collections.Generic;
using System.Linq;

namespace AlgoTracing
{
    public static class TracingExtensions
    {
        public static void EmitArray(this ITracer t, IEnumerable<int> list)
        {
            if (t == null) return;
            var arr = (list ?? Array.Empty<int>()).ToArray();
            t.Step(new { kind = "setArray", value = arr });
        }

        public static void Ptr(this ITracer t, string name, int index, string? tag = null)
            => t?.Step(new { kind = "ptr", name, index, tag });

        public static void ClearPtr(this ITracer t, string name)
            => t?.Step(new { kind = "ptrClear", name });

        public static void Range(this ITracer t, string name, int l, int r, string? tag = null)
            => t?.Step(new { kind = "range", name, l = Math.Min(l, r), r = Math.Max(l, r), tag });

        public static void ClearRange(this ITracer t, string name)
            => t?.Step(new { kind = "rangeClear", name });

        public static void Unmark(this ITracer t, int i, string tag)
            => t?.Step(new { kind = "unmark", i, tag });

        public static void ClearMarks(this ITracer t, string? tag = null)
            => t?.Step(new { kind = "clearMarks", tag });

        // Binary search helpers (auto-mode)
        public static void BeginBinarySearch(this ITracer t, int length, int target)
            => t?.Step(new { kind = "binaryInit", length, target });

        public static void EndBinarySearch(this ITracer t)
            => t?.Step(new { kind = "binaryClear" });

        // Метки (опционально, если захочешь использовать в раннере)
        public static void MarkKey(this ITracer t, int i) => t.Mark(i, "key");
        public static void MarkMin(this ITracer t, int i) => t.Mark(i, "min");
        public static void MarkPivot(this ITracer t, int i) => t.Mark(i, "pivot");
        public static void MarkSorted(this ITracer t, int i) => t.Mark(i, "sorted");

        // Диапазоны (опционально)
        public static void Range(this ITracer t, int l, int r, string? tag = null)
            => t?.Step(new { kind = "range", l = Math.Min(l, r), r = Math.Max(l, r), tag });

        public static void ClearRanges(this ITracer t)
            => t?.Step(new { kind = "clearRanges" });
    }
}
