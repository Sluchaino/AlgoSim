namespace AlgoPlatform.Compiler
{
    public sealed class CompilerOptions
    {
        public string? ContainerRuntime { get; set; }
        public int TimeoutSeconds { get; set; } = 60;
        public double CpuLimit { get; set; } = 1.0;
        public int MemoryMb { get; set; } = 512;
        public int PidsLimit { get; set; } = 256;
        public int MaxErrorChars { get; set; } = 20000;
    }
}
