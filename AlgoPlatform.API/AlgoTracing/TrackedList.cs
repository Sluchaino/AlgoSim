using System;
using System.Collections.Generic;
using System.Linq;

namespace AlgoTracing
{
    public class TrackedList
    {
        private readonly List<int> _data;
        public readonly ITracer _t;

        public int Pivot
        {
            get;
            set;
        }
        public int Left
        {
            get;
            set;
        }

        public int Right
        {
            get;
            set;
        }
        public int I
        {
            get;
            set;
        }

        public int J
        {
            get;
            set;
        }

        public TrackedList(IEnumerable<int> items, ITracer? tracer = null)
        {
            _data = items is List<int> list ? new List<int>(list) : new List<int>(items ?? Array.Empty<int>());
            _t = tracer ?? new NoOpTracer();
        }

        public TrackedList(int capacity = 0, ITracer? tracer = null)
        {
            _data = capacity > 0 ? new List<int>(capacity) : new List<int>();
            _t = tracer ?? new NoOpTracer();
        }

        public int Count => _data.Count;

        // --- Внутренний «ссылочный» int, чтобы сравнения/чтения логировались автоматически
        public readonly struct TrackedInt
        {
            private readonly TrackedList? _owner;
            private readonly int _index;
            private readonly int _constValue;
            private readonly bool _hasIndex;
            
            private TrackedInt(TrackedList owner, int index)
            {
                _owner = owner;
                _index = index;
                _constValue = default;
                _hasIndex = true;
            }

            private TrackedInt(int constant)
            {
                _owner = null;
                _index = -1;
                _constValue = constant;
                _hasIndex = false;
            }

            internal static TrackedInt Ref(TrackedList owner, int index) => new TrackedInt(owner, index);

            // int -> TrackedInt (для ключей/опор)
            public static implicit operator TrackedInt(int value) => new TrackedInt(value);

            // TrackedInt -> int (чтение + лог read)
            public static implicit operator int(TrackedInt x)
            {
                if (x._hasIndex && x._owner is not null)
                {
                    x._owner._t.Read(x._index);
                    return x._owner._data[x._index];
                }
                return x._constValue;
            }

            private static ITracer? PickTracer(in TrackedInt a, in TrackedInt b)
                => a._hasIndex ? a._owner?._t : (b._hasIndex ? b._owner?._t : null);

            private static void EmitCompare(in TrackedInt a, in TrackedInt b)
                => PickTracer(a, b)?.Compare(a._hasIndex ? a._index : -1, b._hasIndex ? b._index : -1);

            // Расширенный compare для анимаций
            private static void EmitCompareEx(in TrackedInt a, in TrackedInt b, int av, int bv, string op, bool result)
                => PickTracer(a, b)?.Step(new
                {
                    kind = "compareEx",
                    i = a._hasIndex ? a._index : -1,
                    j = b._hasIndex ? b._index : -1,
                    ai = av,
                    bj = bv,
                    op,
                    result
                });

            // Операторы сравнений — лог Compare + CompareEx с фактическими значениями
            public static bool operator >(TrackedInt a, TrackedInt b) { EmitCompare(a, b); int av = a, bv = b; bool r = av > bv; EmitCompareEx(a, b, av, bv, ">", r); return r; }
            public static bool operator <(TrackedInt a, TrackedInt b) { EmitCompare(a, b); int av = a, bv = b; bool r = av < bv; EmitCompareEx(a, b, av, bv, "<", r); return r; }
            public static bool operator >=(TrackedInt a, TrackedInt b) { EmitCompare(a, b); int av = a, bv = b; bool r = av >= bv; EmitCompareEx(a, b, av, bv, ">=", r); return r; }
            public static bool operator <=(TrackedInt a, TrackedInt b) { EmitCompare(a, b); int av = a, bv = b; bool r = av <= bv; EmitCompareEx(a, b, av, bv, "<=", r); return r; }
            public static bool operator ==(TrackedInt a, TrackedInt b) { EmitCompare(a, b); int av = a, bv = b; bool r = av == bv; EmitCompareEx(a, b, av, bv, "==", r); return r; }
            public static bool operator !=(TrackedInt a, TrackedInt b) { EmitCompare(a, b); int av = a, bv = b; bool r = av != bv; EmitCompareEx(a, b, av, bv, "!=", r); return r; }

            public override bool Equals(object? obj) => obj is TrackedInt other && ((int)this) == (int)other;
            public override int GetHashCode() => ((int)this).GetHashCode();
        }

        // Индексатор — «ссылка» на элемент (get) и лог Write (set)
        public TrackedInt this[int i]
        {
            get
            {
                BoundsCheck(i);
                return TrackedInt.Ref(this, i);
            }
            set
            {
                BoundsCheck(i);
                int v = value;      // implicit -> int: если value ссылочный, выполнится Read
                _t.Write(i, v);
                _data[i] = v;
            }
        }

        public void Add(int v)
        {
            _data.Add(v);
            _t.Write(_data.Count - 1, v);
        }

        public void Swap(int i, int j)
        {
            BoundsCheck(i); BoundsCheck(j);
            if (i == j) { _t.Step($"swap noop i=j={i}"); return; }
            _t.Swap(i, j);
            (_data[i], _data[j]) = (_data[j], _data[i]);
        }

        public int[] ToArray() => _data.ToArray();

        private void BoundsCheck(int i)
        {
            if ((uint)i >= (uint)_data.Count)
                throw new ArgumentOutOfRangeException(nameof(i), $"Index {i} out of range [0..{_data.Count - 1}]");
        }
    }

}
