using System;

namespace AlgoTracing
{
    public interface ITracer
    {
        // Базовые низкоуровневые операции
        void Compare(int i, int j);
        void Swap(int i, int j);
        void Read(int i);
        void Write(int i, int value);
        void Mark(int i, string? tag = null);

        // Заметки/шаги
        void Step(string? note = null);
        void Step(object? payload);
    }
}
