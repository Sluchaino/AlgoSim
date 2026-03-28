namespace AlgoPlatform.Contracts
{
    public sealed record SubmissionResultResponse(
        Guid Id,
        string Name,
        string Input,
        string Output,
        string Status,
        int? ExitCode,
        string? Error,
        long? DurationMs);
}
