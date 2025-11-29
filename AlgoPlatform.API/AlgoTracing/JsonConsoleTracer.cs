using System;
using System.Linq;
using System.Collections.Generic;
﻿using System.Text.Json;

namespace AlgoTracing
{
    /// <summary>
    /// Трейсер, который печатает шаги в stdout в виде "__STEP__{json}".
    /// Бэкенд ловит этот префикс и прокидывает на фронт как type=step.
    /// Трейсер поддерживает тень массива и распознаёт swap из пары set'ов.
    /// </summary>
    // JsonConsoleTracer.cs
    public sealed class JsonConsoleTracer : ITracer
    {
        // "Зеркало" массива (поддерживается через setArray и наши же события)
        private int[] _arr = Array.Empty<int>();

        // Для детекции swap по двум set'ам
        private (int index, int? old, int value)? _pendingWrite;

        // НОВОЕ: запоминаем последний Read
        private (int index, int value)? _lastRead;

        // ---- ITracer ----

        public void Compare(int i, int j)
            => Emit(new { kind = "compare", i, j });

        public void Swap(int i, int j)
        {
            if (InRange(i) && InRange(j))
                (_arr[i], _arr[j]) = (_arr[j], _arr[i]);

            _pendingWrite = null;
            _lastRead = null;
            Emit(new { kind = "swap", i, j });
        }

        public void Read(int i)
        {
            // Запоминаем индекс и значение на момент чтения (если знаем через зеркало)
            int v = InRange(i) ? _arr[i] : default;
            _lastRead = (i, v);
            Emit(new { kind = "read", i });
        }

        public void Write(int i, int value)
        {
            int? old = InRange(i) ? _arr[i] : (int?)null;

            // 1) Базовый "низкоуровневый" сет (на случай, если фронт хочет пошаговый режим)
            Emit(new { kind = "set", i, value });

            // 2) НОВОЕ: если прямо перед этим был Read(s) того же значения — это копирование s -> i
            if (_lastRead.HasValue)
            {
                var (src, srcVal) = _lastRead.Value;
                if (src != i && srcVal.Equals(value) && InRange(src))
                {
                    Emit(new { kind = "move", from = src, to = i });
                }
            }

            // 3) Старое правило распознавания swap по двум set'ам (оставляем)
            if (old.HasValue)
            {
                if (_pendingWrite.HasValue)
                {
                    var p = _pendingWrite.Value;
                    // если было: set(p.index, value=old) и затем set(i, value=p.old) — это обмен (p.index <-> i)
                    if (p.value == old && value == p.old && p.index != i)
                    {
                        Emit(new { kind = "swap", i = p.index, j = i });
                        _pendingWrite = null;
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

            // 4) Обновляем "зеркало"
            if (InRange(i)) _arr[i] = value;

            // 5) Этот Read «израсходовали»
            _lastRead = null;
        }

        public void Mark(int i, string? tag = null)
            => Emit(new { kind = "mark", i, tag });

        public void Step(string? note = null)
            => Step((object)new { kind = "note", text = note });

        public void Step(object? payload)
        {
            if (payload is not null)
            {
                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));
                if (doc.RootElement.TryGetProperty("kind", out var k) && k.GetString() == "setArray")
                {
                    var vals = doc.RootElement.GetProperty("value").EnumerateArray().Select(x => x.GetInt32()).ToArray();
                    _arr = vals;                   // ← обновить зеркало
                    Emit(payload);                 // ← пробросить дальше на фронт
                    return;
                }
            }
            TryUpdateMirrorFromPayload(payload); // поддержка setArray
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

        private void Emit(object? payload)
        {
            var line = System.Text.Json.JsonSerializer.Serialize(new
            {
                ts = DateTimeOffset.UtcNow,
                type = "step",
                payload
            });
            Console.WriteLine("__STEP__" + line);
        }
    }
}