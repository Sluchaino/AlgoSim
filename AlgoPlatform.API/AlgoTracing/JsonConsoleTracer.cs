using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace AlgoTracing
{
    /// <summary>
    /// Трейсер, который печатает шаги в stdout в виде "__STEP__{json}".
    /// Бэкенд ловит этот префикс и прокидывает на фронт как type=step.
    /// Трейсер поддерживает тень массива и распознает swap из пары set'ов.
    /// </summary>
    // JsonConsoleTracer.cs
    public sealed class JsonConsoleTracer : ITracer
    {
        // «Зеркало» массива (поддерживается через setArray и наши же события)
        private int[] _arr = Array.Empty<int>();

        // Для детекции swap по двум set'ам (буферизуем одиночный set, чтобы не мигал "полушаг")
        private (int index, int? old, int value, int[] after)? _pendingWrite;

        // Запоминаем последний Read
        private (int index, int value)? _lastRead;
        private bool _hasCompareContext;
        private int _compareI;
        private int _compareJ;
        private int? _compareAi;
        private int? _compareBj;
        private int? _compareReadI;
        private int? _compareReadJ;

        // Binary search auto-trace state
        private bool _binaryMode;
        private int _binLeft;
        private int _binRight;
        private int _binTarget;
        private bool _binEqChecked;
        private bool _binEqWasTrue;
        private bool _binFound;
        private int _binReadIndex = -1;
        private bool _binReadSeen;

        public void Compare(int i, int j)
        {
            FlushPendingWrite();
            int? ai = InRange(i) ? _arr[i] : (int?)null;
            int? bj = InRange(j) ? _arr[j] : (int?)null;
            _hasCompareContext = true;
            _compareI = i;
            _compareJ = j;
            _compareAi = ai;
            _compareBj = bj;
            _compareReadI = null;
            _compareReadJ = null;

            if (_binaryMode && ((i == -1 && j >= 0) || (j == -1 && i >= 0)))
            {
                return;
            }

            Emit(new { kind = "compare", i, j, ai, bj });
        }

        public void Swap(int i, int j)
        {
            FlushPendingWrite();
            int? ai = InRange(i) ? _arr[i] : (int?)null;
            int? bj = InRange(j) ? _arr[j] : (int?)null;

            if (InRange(i) && InRange(j))
                (_arr[i], _arr[j]) = (_arr[j], _arr[i]);

            _pendingWrite = null;
            _lastRead = null;
            ClearCompareContext();

            Emit(new { kind = "swap", i, j, ai, bj, after = _arr.ToArray() });
        }

        public void Read(int i)
        {
            FlushPendingWrite();
            int v = InRange(i) ? _arr[i] : default;
            _lastRead = (i, v);
            if (_hasCompareContext)
            {
                if (i == _compareI && !_compareReadI.HasValue) _compareReadI = v;
                if (i == _compareJ && !_compareReadJ.HasValue) _compareReadJ = v;
            }

            if (_binaryMode && _binReadSeen && _binReadIndex == i)
            {
                return;
            }

            if (_binaryMode)
            {
                _binReadSeen = true;
                _binReadIndex = i;
            }

            Emit(new { kind = "read", i, value = v });
        }

        public void Write(int i, int value)
        {
            int? old = InRange(i) ? _arr[i] : (int?)null;

            // move: если сразу перед этим читали src того же значения
            if (_lastRead.HasValue)
            {
                var (src, srcVal) = _lastRead.Value;
                if (src != i && srcVal.Equals(value) && InRange(src))
                {
                    Emit(new { kind = "move", from = src, to = i, value = srcVal }); // информативное событие
                }
            }

            // Детекция возможного swap'а из пары set'ов (нужно знать old)
            if (old.HasValue)
            {
                if (_pendingWrite.HasValue)
                {
                    var p = _pendingWrite.Value;
                    if (p.value == old && value == p.old && p.index != i)
                    {
                        // Это обмен двух ячеек, собранный из пары set.
                        // Первый set уже применён в зеркале, поэтому применяем только второй и
                        // отдаём единый swap без промежуточного резкого "set"-кадра.
                        if (InRange(i)) _arr[i] = value;
                        Emit(new { kind = "swap", i = p.index, j = i, ai = p.old, bj = old, after = _arr.ToArray() });
                        _pendingWrite = null;
                        _lastRead = null;
                        ClearCompareContext();
                        return;
                    }

                    FlushPendingWrite();
                }

                if (InRange(i)) _arr[i] = value;
                _pendingWrite = (i, old, value, _arr.ToArray());
                _lastRead = null;
                ClearCompareContext();
                return;
            }

            FlushPendingWrite();
            if (InRange(i)) _arr[i] = value;
            Emit(new { kind = "set", i, value, old, after = _arr.ToArray() });
            _lastRead = null;
            ClearCompareContext();
        }

        public void Mark(int i, string? tag = null)
        {
            FlushPendingWrite();
            int? value = InRange(i) ? _arr[i] : (int?)null;
            ClearCompareContext();
            Emit(new { kind = "mark", i, tag, value });
        }

        public void Step(string? note = null) => Step((object)new { kind = "note", text = note });

        public void Step(object? payload)
        {
            FlushPendingWrite();
            // Спец-обработка setArray: обновляем зеркало и печатаем after
            if (payload is not null)
            {
                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));
                if (doc.RootElement.TryGetProperty("kind", out var k) && k.GetString() == "setArray")
                {
                    var vals = doc.RootElement.GetProperty("value").EnumerateArray().Select(x => x.GetInt32()).ToArray();
                    _arr = vals;
                    if (_binaryMode)
                    {
                        _binLeft = 0;
                        _binRight = _arr.Length - 1;
                        _binEqChecked = false;
                        _binEqWasTrue = false;
                        _binFound = false;
                    }
                    Emit(new { kind = "setArray", value = vals, after = _arr.ToArray() });
                    _pendingWrite = null;
                    _lastRead = null;
                    ClearCompareContext();
                    return;
                }
            }

            if (payload != null)
            {
                var kind = GetStringProp(payload, "kind");
                if (kind == "binaryInit")
                {
                    HandleBinaryInit(payload);
                    return;
                }
                if (kind == "binaryClear")
                {
                    ClearBinaryState();
                    return;
                }
                if (kind == "compareEx")
                {
                    payload = NormalizeCompareExPayload(payload);
                    HandleBinaryCompareEx(payload);
                    ClearCompareContext();
                }
            }

            TryUpdateMirrorFromPayload(payload);
            payload = TryEnrichPayload(payload);
            Emit(payload);
        }

        // ---- утилиты ----

        private bool InRange(int i) => (uint)i < (uint)_arr.Length;

        private void FlushPendingWrite()
        {
            if (!_pendingWrite.HasValue) return;
            var p = _pendingWrite.Value;
            Emit(new { kind = "set", i = p.index, value = p.value, old = p.old, after = p.after });
            _pendingWrite = null;
        }

        private void ClearCompareContext()
        {
            _hasCompareContext = false;
            _compareI = -1;
            _compareJ = -1;
            _compareAi = null;
            _compareBj = null;
            _compareReadI = null;
            _compareReadJ = null;
        }

        private object NormalizeCompareExPayload(object payload)
        {
            var i = GetIntProp(payload, "i", -2);
            var j = GetIntProp(payload, "j", -2);
            var ai = GetIntProp(payload, "ai", 0);
            var bj = GetIntProp(payload, "bj", 0);
            var op = GetStringProp(payload, "op") ?? string.Empty;
            var result = GetBoolProp(payload, "result", false);

            if (_hasCompareContext && _compareI == i && _compareJ == j)
            {
                if (i >= 0)
                {
                    ai = _compareReadI ?? _compareAi ?? ai;
                }
                if (j >= 0)
                {
                    bj = _compareReadJ ?? _compareBj ?? bj;
                }

                if (TryEvaluateCompare(ai, bj, op, out var normalizedResult))
                {
                    result = normalizedResult;
                }
            }

            return new { kind = "compareEx", i, j, ai, bj, op, result };
        }

        private static bool TryEvaluateCompare(int ai, int bj, string op, out bool result)
        {
            result = false;
            switch (op)
            {
                case ">":
                    result = ai > bj;
                    return true;
                case "<":
                    result = ai < bj;
                    return true;
                case ">=":
                    result = ai >= bj;
                    return true;
                case "<=":
                    result = ai <= bj;
                    return true;
                case "==":
                    result = ai == bj;
                    return true;
                case "!=":
                    result = ai != bj;
                    return true;
                default:
                    return false;
            }
        }

        private object? TryEnrichPayload(object? payload)
        {
            if (payload == null) return null;

            var kind = GetStringProp(payload, "kind");
            if (string.IsNullOrWhiteSpace(kind)) return payload;

            if (kind == "ptr")
            {
                var name = GetStringProp(payload, "name") ?? "ptr";
                var index = GetIntProp(payload, "index", -1);
                var tag = GetStringProp(payload, "tag");
                int? value = InRange(index) ? _arr[index] : (int?)null;
                return new { kind = "ptr", name, index, tag, value };
            }

            if (kind == "unmark")
            {
                var i = GetIntProp(payload, "i", -1);
                var tag = GetStringProp(payload, "tag");
                int? value = InRange(i) ? _arr[i] : (int?)null;
                return new { kind = "unmark", i, tag, value };
            }

            if (kind == "range")
            {
                var name = GetStringProp(payload, "name") ?? "range";
                var l = GetIntProp(payload, "l", 0);
                var r = GetIntProp(payload, "r", 0);
                var tag = GetStringProp(payload, "tag");
                int? leftValue = InRange(l) ? _arr[l] : (int?)null;
                int? rightValue = InRange(r) ? _arr[r] : (int?)null;
                return new { kind = "range", name, l, r, tag, leftValue, rightValue };
            }

            return payload;
        }

        private void TryUpdateMirrorFromPayload(object? payload)
        {
            if (payload == null) return;
            var t = payload.GetType();
            var kindProp = t.GetProperty("kind");
            if (kindProp?.GetValue(payload) as string is not string kind) return;

            if (kind == "setArray")
            {
                var valProp = t.GetProperty("value")?.GetValue(payload);
                if (valProp is IEnumerable<int> seq) _arr = seq.ToArray();
                else _arr = Array.Empty<int>();
                _pendingWrite = null;
                _lastRead = null;
            }
        }

        private void HandleBinaryInit(object payload)
        {
            var length = GetIntProp(payload, "length", _arr.Length);
            var target = GetIntProp(payload, "target", 0);

            _binaryMode = true;
            _binLeft = 0;
            _binRight = Math.Max(-1, length - 1);
            _binTarget = target;
            _binEqChecked = false;
            _binEqWasTrue = false;
            _binFound = false;
            _binReadSeen = false;
            _binReadIndex = -1;

            if (_binLeft <= _binRight)
            {
                Emit(new { kind = "range", name = "window", l = _binLeft, r = _binRight, tag = "active" });
            }
        }

        private void ClearBinaryState()
        {
            if (_binaryMode)
            {
                Emit(new { kind = "rangeClear", name = "window" });
                Emit(new { kind = "ptrClear", name = "mid" });
            }
            _binaryMode = false;
            _binLeft = 0;
            _binRight = -1;
            _binEqChecked = false;
            _binEqWasTrue = false;
            _binFound = false;
            _binReadSeen = false;
            _binReadIndex = -1;
        }

        private void HandleBinaryCompareEx(object payload)
        {
            if (!_binaryMode || _binFound) return;

            var op = GetStringProp(payload, "op") ?? string.Empty;
            var result = GetBoolProp(payload, "result", false);
            var i = GetIntProp(payload, "i", -2);
            var j = GetIntProp(payload, "j", -2);
            var ai = GetIntProp(payload, "ai", 0);
            var bj = GetIntProp(payload, "bj", 0);

            int idx;
            int constVal;
            if (i == -1 && j >= 0)
            {
                idx = j;
                constVal = ai;
            }
            else if (j == -1 && i >= 0)
            {
                idx = i;
                constVal = bj;
            }
            else
            {
                return;
            }

            if (constVal != _binTarget) return;

            if (_binLeft <= _binRight)
            {
                Emit(new { kind = "range", name = "window", l = _binLeft, r = _binRight, tag = "active" });
            }
            Emit(new { kind = "ptr", name = "mid", index = idx, tag = "mid" });

            if (op == "==")
            {
                _binEqChecked = true;
                _binEqWasTrue = result;
                if (result)
                {
                    Emit(new { kind = "mark", i = idx, tag = "key" });
                    Emit(new { kind = "rangeClear", name = "window" });
                    Emit(new { kind = "ptrClear", name = "mid" });
                    _binFound = true;
                    _binReadSeen = false;
                    _binReadIndex = -1;
                    return;
                }
            }
            else if (op == "<")
            {
                if (result) _binLeft = idx + 1;
                else if (_binEqChecked && !_binEqWasTrue) _binRight = idx - 1;
                _binEqChecked = false;
                _binReadSeen = false;
                _binReadIndex = -1;
            }
            else if (op == ">")
            {
                if (result) _binRight = idx - 1;
                else if (_binEqChecked && !_binEqWasTrue) _binLeft = idx + 1;
                _binEqChecked = false;
                _binReadSeen = false;
                _binReadIndex = -1;
            }
            else
            {
                _binEqChecked = false;
            }

            if (_binLeft > _binRight)
            {
                Emit(new { kind = "rangeClear", name = "window" });
                Emit(new { kind = "ptrClear", name = "mid" });
                Emit(new { kind = "notFound" });
                _binaryMode = false;
                _binReadSeen = false;
                _binReadIndex = -1;
            }
        }

        private static string? GetStringProp(object obj, string name)
        {
            var prop = obj.GetType().GetProperty(name);
            if (prop == null) return null;
            var value = prop.GetValue(obj);
            if (value is string s) return s;
            if (value is JsonElement el && el.ValueKind == JsonValueKind.String) return el.GetString();
            return value?.ToString();
        }

        private static int GetIntProp(object obj, string name, int fallback)
        {
            var prop = obj.GetType().GetProperty(name);
            if (prop == null) return fallback;
            var value = prop.GetValue(obj);
            if (value == null) return fallback;
            if (value is int i) return i;
            if (value is long l) return (int)l;
            if (value is double d) return (int)d;
            if (value is float f) return (int)f;
            if (value is decimal m) return (int)m;
            if (value is JsonElement el && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var n)) return n;
            return fallback;
        }

        private static bool GetBoolProp(object obj, string name, bool fallback)
        {
            var prop = obj.GetType().GetProperty(name);
            if (prop == null) return fallback;
            var value = prop.GetValue(obj);
            if (value == null) return fallback;
            if (value is bool b) return b;
            if (value is JsonElement el && el.ValueKind == JsonValueKind.True) return true;
            if (value is JsonElement el2 && el2.ValueKind == JsonValueKind.False) return false;
            return fallback;
        }

        private void Emit(object? payload)
        {
            var line = JsonSerializer.Serialize(new { ts = DateTimeOffset.UtcNow, type = "step", payload });
            Console.WriteLine("__STEP__" + line);
        }
    }
}
