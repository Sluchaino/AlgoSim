namespace AlgoPlatform.Contracts.Runner
{
    public sealed record SubmissionHeartbeatMessage(
        Guid SubmissionId,
        string State,
        int? Progress = null,
        string? Message = null);
}
