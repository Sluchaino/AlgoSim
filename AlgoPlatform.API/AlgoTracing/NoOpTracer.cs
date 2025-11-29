using System;

namespace AlgoTracing
{
    /// <summary>
    /// Трейсер-заглушка: ничего не делает, но удовлетворяет интерфейсу.
    /// </summary>
    public sealed class NoOpTracer : ITracer
    {
        public void Compare(int i, int j) { }
        public void Swap(int i, int j) { }
        public void Read(int i) { }
        public void Write(int i, int value) { }
        public void Mark(int i, string? tag = null) { }
        public void Step(string? note = null) { }
        public void Step(object? payload) { }
    }
}