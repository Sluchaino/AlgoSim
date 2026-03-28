using System.Net.Http.Json;
using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Contracts.Runner;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace AlgoPlatform.Infrastructure.Execution.Http
{
    public sealed class RunnerHttpCodeRunner : ICodeRunner
    {
        private readonly HttpClient _http;
        private readonly ILogger<RunnerHttpCodeRunner> _logger;
        private readonly int? _timeoutSeconds;
        private readonly int? _maxOutputChars;

        public RunnerHttpCodeRunner(
            HttpClient http,
            ILogger<RunnerHttpCodeRunner> logger,
            IConfiguration configuration)
        {
            _http = http;
            _logger = logger;
            _timeoutSeconds = configuration.GetValue<int?>("Runner:TimeoutSeconds");
            _maxOutputChars = configuration.GetValue<int?>("Runner:MaxOutputChars");
        }

        public async Task<(int ExitCode, string Stdout, string Stderr, long DurationMs, bool TimedOut)> RunAsync(
            string code,
            string input,
            CancellationToken ct)
        {
            var req = new RunCodeRequest(
                code ?? string.Empty,
                input,
                _timeoutSeconds,
                _maxOutputChars);

            using var res = await _http.PostAsJsonAsync("run", req, ct);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("Runner returned {StatusCode}: {Body}", (int)res.StatusCode, body);
                throw new InvalidOperationException($"Runner returned status {(int)res.StatusCode}.");
            }

            var result = await res.Content.ReadFromJsonAsync<RunCodeResponse>(cancellationToken: ct);
            if (result is null)
            {
                throw new InvalidOperationException("Runner response was empty.");
            }

            return (
                result.ExitCode,
                result.Stdout ?? string.Empty,
                result.Stderr ?? string.Empty,
                result.DurationMs,
                result.TimedOut);
        }
    }
}
