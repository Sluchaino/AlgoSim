namespace AlgoPlatform.Options
{
    public sealed class SubmissionStatusTimeouts
    {
        public int QueuedSeconds { get; set; } = 300;
        public int CompilingSeconds { get; set; } = 300;
        public int RunningSeconds { get; set; } = 300;
        public int RetryingSeconds { get; set; } = 300;
    }
}
