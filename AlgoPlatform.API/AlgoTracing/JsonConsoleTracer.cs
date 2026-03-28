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

        // Для детекции swap по двум set'ам
        private (int index, int? old, int value)? _pendingWrite;

        // Запоминаем последний Read
        private (int index, int value)? _lastRead;

        // Binary search auto-trace state
        private bool _binaryMode;
        private int _binLeft;
        private int _binRight;
        private int _binTarget;
        private bool _binEqChecked;
        private bool _binEqWasTrue;
        private bool _binFound;

        public void Compare(int i, int j) => Emit(new { kind = "compare", i, j });

        public void Swap(int i, int j)
        {
            if (InRange(i) && InRange(j))
                (_arr[i], _arr[j]) = (_arr[j], _arr[i]);

            _pendingWrite = null;
            _lastRead = null;

            // В той же строке отдаём массив после обмена
            Emit(new { kind = "swap", i, j, after = _arr.ToArray() });
        }

        public void Read(int i)
        {
            int v = InRange(i) ? _arr[i] : default;
            _lastRead = (i, v);
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
                    Emit(new { kind = "move", from = src, to = i }); // информативное событие
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
                        // это обмен двух ячеек
                        // сначала обновим зеркало как будто set отработал...
                        if (InRange(i)) _arr[i] = value;
                        // ...а затем отдадим единое событие swap с after
                        (_arr[p.index], _arr[i]) = (_arr[i], _arr[p.index]);
                        Emit(new { kind = "swap", i = p.index, j = i, after = _arr.ToArray() });
                        _pendingWrite = null;
                        _lastRead = null;
                        return;
                    }
                    else
                    {
                        _pendingWrite = (i, old, value);
                    }
                }
                else
                {
                    _pendingWrite = (i, old, value);
                }
            }
            else
            {
                _pendingWrite = null;
            }

            // Обновляем зеркало
            if (InRange(i)) _arr[i] = value;

            // Главный «низкоуровневый» set + снимок массива после изменения
            Emit(new { kind = "set", i, value, after = _arr.ToArray() });

            _lastRead = null;
        }

        public void Mark(int i, string? tag = null) => Emit(new { kind = "mark", i, tag });

        public void Step(string? note = null) => Step((object)new { kind = "note", text = note });

        public void Step(object? payload)
        {
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
                    HandleBinaryCompareEx(payload);
                }
            }

            TryUpdateMirrorFromPayload(payload);
            Emit(payload);
        }

        // ---- утилиты ----

        private bool InRange(int i) => (uint)i < (uint)_arr.Length;

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
                    return;
                }
            }
            else if (op == "<")
            {
                if (result) _binLeft = idx + 1;
                else if (_binEqChecked && !_binEqWasTrue) _binRight = idx - 1;
                _binEqChecked = false;
            }
            else if (op == ">")
            {
                if (result) _binRight = idx - 1;
                else if (_binEqChecked && !_binEqWasTrue) _binLeft = idx + 1;
                _binEqChecked = false;
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
