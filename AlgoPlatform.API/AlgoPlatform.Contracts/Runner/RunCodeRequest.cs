namespace AlgoPlatform.Contracts.Runner
{
    public sealed record RunCodeRequest(
        string Code,
        string? Input = null,
        int? TimeoutSeconds = null,
        int? MaxOutputChars = null);
}
