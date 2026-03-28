namespace AlgoPlatform.Contracts.Runner
{
    public sealed record RunJobMessage(
        Guid SubmissionId,
        string? Code,
        string? Input,
        string? ArtifactKey = null);
}
