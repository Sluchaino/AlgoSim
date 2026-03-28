using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Application.Abstractions
{
    public interface ICodeRunner
    {
        Task<(int ExitCode, string Stdout, string Stderr, long DurationMs, bool TimedOut)> RunAsync(
            string code,
            string input,
            CancellationToken ct);
    }
}
