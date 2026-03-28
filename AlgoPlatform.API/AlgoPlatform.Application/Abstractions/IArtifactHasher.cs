namespace AlgoPlatform.Application.Abstractions
{
    public interface IArtifactHasher
    {
        string ComputeHash(string code);
        string? CurrentAlgoTracingHash { get; }
    }
}
