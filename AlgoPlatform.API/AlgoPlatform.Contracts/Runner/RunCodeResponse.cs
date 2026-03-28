namespace AlgoPlatform.Contracts.Runner
{
    public sealed record RunCodeResponse(int ExitCode, string Stdout, string Stderr, long DurationMs, bool TimedOut);
}
