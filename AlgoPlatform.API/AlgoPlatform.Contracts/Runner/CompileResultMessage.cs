namespace AlgoPlatform.Contracts.Runner
{
    public sealed record CompileResultMessage(
        Guid SubmissionId,
        string ArtifactHash,
        bool Success,
        string? StorageKey,
        string? Error,
        long DurationMs);
}
