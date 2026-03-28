namespace AlgoPlatform.Domain.Models.Metrics
{
    public sealed class SubmissionMetrics
    {
        public int Total { get; init; }
        public int Queued { get; init; }
        public int Running { get; init; }
        public int Completed { get; init; }
        public int Failed { get; init; }
    }
}
