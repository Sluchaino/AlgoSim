namespace AlgoPlatform.Contracts
{
    public sealed record SubmissionMetricsResponse(
        int Total,
        int Queued,
        int Running,
        int Completed,
        int Failed);
}
