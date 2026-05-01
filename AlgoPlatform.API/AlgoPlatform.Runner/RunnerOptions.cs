namespace AlgoPlatform.Runner
{
    public sealed class RunnerOptions
    {
        public int TimeoutSeconds { get; set; } = 25;
        public int MaxOutputChars { get; set; } = 200_000;
        public double CpuLimit { get; set; } = 0.5;
        public int MemoryMb { get; set; } = 256;
        public int PidsLimit { get; set; } = 64;
        public int MaxConcurrent { get; set; } = 1;
        public int HeartbeatIntervalSeconds { get; set; } = 2;
        public string? ContainerRuntime { get; set; }
    }
}
