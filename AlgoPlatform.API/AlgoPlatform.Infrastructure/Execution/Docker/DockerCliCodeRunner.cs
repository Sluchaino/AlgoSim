using AlgoPlatform.Application.Abstractions;
using System.Diagnostics;

namespace AlgoPlatform.Infrastructure.Execution.Docker
{
    public sealed class DockerCliCodeRunner : ICodeRunner
    {
        private const string Image = "mcr.microsoft.com/dotnet/sdk:9.0"; // или 8.0, как тебе надо

        public async Task<(int ExitCode, string Stdout, string Stderr)> RunAsync(string code, string input, CancellationToken ct)
        {
            // TODO: сюда перенеси свою логику из старого Runner (подготовка csproj/Program.cs, dotnet run, таймауты/лимиты).
            // Ниже — максимально упрощённый пример; для реальной песочницы используй твой код.
            var temp = Path.Combine(Path.GetTempPath(), "algo", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            await File.WriteAllTextAsync(Path.Combine(temp, "Program.cs"), code, ct);
            await File.WriteAllTextAsync(Path.Combine(temp, "input.txt"), input ?? "", ct);

            var sh = "set -euo pipefail; dotnet new console -n App -o /tmp/app -f net9.0 >/dev/null; " +
                     "cp /work/Program.cs /tmp/app/Program.cs; " +
                     "cd /tmp/app; dotnet run -- input.txt";

            var psi = new ProcessStartInfo("docker",
                $"run --rm --network none --cpus 1 --memory 512m -v \"{temp}:/work\" {Image} sh -lc \"{sh}\"")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };

            using var p = Process.Start(psi)!;
            var stdout = await p.StandardOutput.ReadToEndAsync();
            var stderr = await p.StandardError.ReadToEndAsync();
            await p.WaitForExitAsync(ct);

            try { Directory.Delete(temp, true); } catch { /* ignore */ }
            return (p.ExitCode, stdout, stderr);
        }
    }
}
