namespace AlgoPlatform.Contracts.Runner
{
    public sealed record CompileJobMessage(
        Guid SubmissionId,
        string Code,
        string ArtifactHash);
}
