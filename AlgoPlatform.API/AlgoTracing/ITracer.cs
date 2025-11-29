using System;

namespace AlgoTracing
{
    public interface ITracer
    {
        // Базовые операции
        void Compare(int i, int j);
        void Swap(int i, int j);
        void Read(int i);
        void Write(int i, int value);
        void Mark(int i, string? tag = null);

        // Заметки/шаги
        void Step(string? note = null);

        // НОВОЕ: структурный шаг — отправляем произвольный payload (например, setArray, метки, кастомные события)
        void Step(object? payload);
    }
}