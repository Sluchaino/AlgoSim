using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;
using AlgoPlatform.Runner;
using AlgoTracing;

namespace AlgoPlatform.Runner.Execution
{
    public sealed class DockerCliCodeRunner
    {
        private const string Image = "mcr.microsoft.com/dotnet/sdk:10.0-alpine";
        private readonly RunnerOptions _options;

        public DockerCliCodeRunner(RunnerOptions options)
        {
            _options = options;
        }

        public async Task<(int ExitCode, string Stdout, string Stderr, long DurationMs, bool TimedOut)> RunAsync(
            string code,
            string? input,
            int? timeoutSeconds,
            int? maxOutputChars,
            CancellationToken ct)
        {
            var maxChars = maxOutputChars.HasValue && maxOutputChars.Value > 0
                ? maxOutputChars.Value
                : _options.MaxOutputChars;
            var timeout = TimeSpan.FromSeconds(timeoutSeconds.HasValue && timeoutSeconds.Value > 0
                ? Math.Min(timeoutSeconds.Value, _options.TimeoutSeconds)
                : _options.TimeoutSeconds);

            var codeB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(code ?? string.Empty));

            var csprojXml = string.Join("\n", new[]
            {
                "<Project Sdk=\"Microsoft.NET.Sdk\">",
                "  <PropertyGroup>",
                "    <OutputType>Exe</OutputType>",
                "    <TargetFramework>net10.0</TargetFramework>",
                "    <ImplicitUsings>enable</ImplicitUsings>",
                "    <Nullable>enable</Nullable>",
                "  </PropertyGroup>",
                "  <ItemGroup>",
                "    <Reference Include=\"AlgoTracing\">",
                "      <HintPath>/tmp/algotracing/AlgoTracing.dll</HintPath>",
                "      <Private>true</Private>",
                "    </Reference>",
                "  </ItemGroup>",
                "</Project>"
            });
            var csprojB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(csprojXml));

            var algoDllPath = typeof(AlgoRunner).Assembly.Location;
            if (string.IsNullOrWhiteSpace(algoDllPath) || !File.Exists(algoDllPath))
            {
                throw new FileNotFoundException(
                    "AlgoTracing.dll not found next to the runner application.",
                    algoDllPath);
            }

            var algoDllBytes = await File.ReadAllBytesAsync(algoDllPath, ct);
            var algoDllB64 = Convert.ToBase64String(algoDllBytes);

            var inputB64 = input is null
                ? string.Empty
                : Convert.ToBase64String(Encoding.UTF8.GetBytes(input));

            var dockerPath = ResolveDockerPath();
            var dockerConfig = EnsureMinimalDockerConfig();
            var runtimeArg = string.IsNullOrWhiteSpace(_options.ContainerRuntime)
                ? string.Empty
                : $"--runtime {_options.ContainerRuntime} ";

            var sh =
                "set -euo pipefail; " +
                "mkdir -p /tmp/app /tmp/algotracing /tmp/nuget /tmp/out && " +
                "printf \"%s\" \"$CSPROJ_B64\"   | base64 -d > /tmp/app/App.csproj && " +
                "printf \"%s\" \"$CODE_B64\"     | base64 -d > /tmp/app/Program.cs && " +
                "printf \"%s\" \"$ALGO_DLL_B64\" | base64 -d > /tmp/algotracing/AlgoTracing.dll && " +
                "if [ -n \"${INPUT_B64:-}\" ]; then printf \"%s\" \"$INPUT_B64\" | base64 -d > /tmp/app/input.txt; fi && " +
                "cd /tmp/app && " +
                "dotnet build -c Release -o /tmp/out -p:DisableWorkloadResolver=true && " +
                "if [ -f input.txt ]; then dotnet /tmp/out/App.dll < input.txt; else dotnet /tmp/out/App.dll; fi";

            var cpuLimit = _options.CpuLimit.ToString(CultureInfo.InvariantCulture);
            var args =
                $"run --rm --pull=missing {runtimeArg}--network none --read-only " +
                $"--tmpfs /tmp:rw,size=256m,mode=1777,exec --tmpfs /var/tmp:rw,size=64m,mode=1777,exec " +
                $"--cap-drop ALL --security-opt no-new-privileges --user 65532:65532 " +
                $"--cpus {cpuLimit} --memory {_options.MemoryMb}m --pids-limit {_options.PidsLimit} " +
                $"-e CODE_B64 -e CSPROJ_B64 -e ALGO_DLL_B64 -e INPUT_B64 " +
                $"-e DOTNET_CLI_HOME=/tmp -e NUGET_PACKAGES=/tmp/nuget -e HOME=/tmp " +
                "-e DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 -e DOTNET_CLI_TELEMETRY_OPTOUT=1 " +
                "-e DOTNET_NOLOGO=1 -e DOTNET_MULTILEVEL_LOOKUP=0 " +
                $"{Image} sh -lc \"{sh}\"";

            var psi = new ProcessStartInfo(dockerPath, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            psi.Environment["DOCKER_CONFIG"] = dockerConfig;
            psi.Environment["CODE_B64"] = codeB64;
            psi.Environment["CSPROJ_B64"] = csprojB64;
            psi.Environment["ALGO_DLL_B64"] = algoDllB64;
            psi.Environment["INPUT_B64"] = inputB64;

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = false };

            var stdoutBuilder = new StringBuilder();
            var stderrBuilder = new StringBuilder();
            var stdoutTruncated = false;
            var stderrTruncated = false;

            void AppendLimited(StringBuilder sb, string data, ref bool truncated)
            {
                if (sb.Length >= maxChars) return;
                var remaining = maxChars - sb.Length;
                if (data.Length <= remaining)
                {
                    sb.AppendLine(data);
                }
                else
                {
                    sb.Append(data.AsSpan(0, remaining));
                    truncated = true;
                }
            }

            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                AppendLimited(stdoutBuilder, e.Data, ref stdoutTruncated);
            };
            proc.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                AppendLimited(stderrBuilder, e.Data, ref stderrTruncated);
            };

            var sw = Stopwatch.StartNew();
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            var waitTask = proc.WaitForExitAsync();
            var timeoutTask = Task.Delay(timeout);
            var cancelTask = Task.Delay(Timeout.InfiniteTimeSpan, ct);

            var finished = await Task.WhenAny(waitTask, timeoutTask, cancelTask);

            var timedOut = false;
            if (finished == timeoutTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                stderrBuilder.AppendLine($"Execution timed out after {timeout.TotalSeconds} seconds.");
                timedOut = true;
            }
            else if (finished == cancelTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                throw new OperationCanceledException(ct);
            }

            await waitTask;

            var stdout = stdoutBuilder.ToString();
            var stderr = StripWorkloadWarnings(stderrBuilder.ToString());

            if (stdoutTruncated) stdout += "\n--OUTPUT_TRUNCATED--";
            if (stderrTruncated) stderr += "\n--OUTPUT_TRUNCATED--";

            sw.Stop();
            return (proc.ExitCode, stdout, stderr, (long)sw.Elapsed.TotalMilliseconds, timedOut);
        }

        public async Task<(int ExitCode, string Stdout, string Stderr, long DurationMs, bool TimedOut)> RunPrecompiledAsync(
            byte[] artifactTarGz,
            string? input,
            int? timeoutSeconds,
            int? maxOutputChars,
            CancellationToken ct)
        {
            var maxChars = maxOutputChars.HasValue && maxOutputChars.Value > 0
                ? maxOutputChars.Value
                : _options.MaxOutputChars;
            var timeout = TimeSpan.FromSeconds(timeoutSeconds.HasValue && timeoutSeconds.Value > 0
                ? Math.Min(timeoutSeconds.Value, _options.TimeoutSeconds)
                : _options.TimeoutSeconds);

            var artifactB64 = Convert.ToBase64String(artifactTarGz);

            var inputB64 = input is null
                ? string.Empty
                : Convert.ToBase64String(Encoding.UTF8.GetBytes(input));

            var dockerPath = ResolveDockerPath();
            var dockerConfig = EnsureMinimalDockerConfig();
            var runtimeArg = string.IsNullOrWhiteSpace(_options.ContainerRuntime)
                ? string.Empty
                : $"--runtime {_options.ContainerRuntime} ";

            var sh =
                "set -euo pipefail; " +
                "mkdir -p /tmp/out /tmp/nuget && " +
                "printf \"%s\" \"$ARTIFACT_B64\" | base64 -d > /tmp/out.tar.gz && " +
                "tar -xzf /tmp/out.tar.gz -C /tmp/out && " +
                "if [ -n \"${INPUT_B64:-}\" ]; then printf \"%s\" \"$INPUT_B64\" | base64 -d > /tmp/input.txt; fi && " +
                "if [ -f /tmp/input.txt ]; then dotnet /tmp/out/App.dll < /tmp/input.txt; else dotnet /tmp/out/App.dll; fi";

            var cpuLimit = _options.CpuLimit.ToString(CultureInfo.InvariantCulture);
            var args =
                $"run --rm --pull=missing {runtimeArg}--network none --read-only " +
                $"--tmpfs /tmp:rw,size=256m,mode=1777,exec --tmpfs /var/tmp:rw,size=64m,mode=1777,exec " +
                $"--cap-drop ALL --security-opt no-new-privileges --user 65532:65532 " +
                $"--cpus {cpuLimit} --memory {_options.MemoryMb}m --pids-limit {_options.PidsLimit} " +
                $"-e ARTIFACT_B64 -e INPUT_B64 " +
                $"-e DOTNET_CLI_HOME=/tmp -e NUGET_PACKAGES=/tmp/nuget -e HOME=/tmp " +
                "-e DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 -e DOTNET_CLI_TELEMETRY_OPTOUT=1 " +
                "-e DOTNET_NOLOGO=1 -e DOTNET_MULTILEVEL_LOOKUP=0 " +
                $"{Image} sh -lc \"{sh}\"";

            var psi = new ProcessStartInfo(dockerPath, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            psi.Environment["DOCKER_CONFIG"] = dockerConfig;
            psi.Environment["ARTIFACT_B64"] = artifactB64;
            psi.Environment["INPUT_B64"] = inputB64;

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = false };

            var stdoutBuilder = new StringBuilder();
            var stderrBuilder = new StringBuilder();
            var stdoutTruncated = false;
            var stderrTruncated = false;

            void AppendLimited(StringBuilder sb, string data, ref bool truncated)
            {
                if (sb.Length >= maxChars) return;
                var remaining = maxChars - sb.Length;
                if (data.Length <= remaining)
                {
                    sb.AppendLine(data);
                }
                else
                {
                    sb.Append(data.AsSpan(0, remaining));
                    truncated = true;
                }
            }

            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                AppendLimited(stdoutBuilder, e.Data, ref stdoutTruncated);
            };
            proc.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                AppendLimited(stderrBuilder, e.Data, ref stderrTruncated);
            };

            var sw = Stopwatch.StartNew();
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            var waitTask = proc.WaitForExitAsync();
            var timeoutTask = Task.Delay(timeout);
            var cancelTask = Task.Delay(Timeout.InfiniteTimeSpan, ct);

            var finished = await Task.WhenAny(waitTask, timeoutTask, cancelTask);

            var timedOut = false;
            if (finished == timeoutTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                stderrBuilder.AppendLine($"Execution timed out after {timeout.TotalSeconds} seconds.");
                timedOut = true;
            }
            else if (finished == cancelTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                throw new OperationCanceledException(ct);
            }

            await waitTask;

            var stdout = stdoutBuilder.ToString();
            var stderr = StripWorkloadWarnings(stderrBuilder.ToString());

            if (stdoutTruncated) stdout += "\n--OUTPUT_TRUNCATED--";
            if (stderrTruncated) stderr += "\n--OUTPUT_TRUNCATED--";

            sw.Stop();
            return (proc.ExitCode, stdout, stderr, (long)sw.Elapsed.TotalMilliseconds, timedOut);
        }

        private static string StripWorkloadWarnings(string stderr)
        {
            if (string.IsNullOrWhiteSpace(stderr)) return stderr;

            var lines = stderr
                .Split('\n', StringSplitOptions.None)
                .Where(l =>
                {
                    var t = l.Trim();
                    return !t.Contains("An issue was encountered verifying workloads.", StringComparison.OrdinalIgnoreCase)
                        && !t.Contains("dotnet workload update", StringComparison.OrdinalIgnoreCase);
                })
                .ToArray();

            return string.Join('\n', lines).TrimEnd();
        }

        private static string EnsureMinimalDockerConfig()
        {
            var root = Path.Combine(Path.GetTempPath(), "docker-config-empty");
            Directory.CreateDirectory(root);
            var cfg = Path.Combine(root, "config.json");
            if (!File.Exists(cfg)) File.WriteAllText(cfg, "{}");
            return root;
        }

        private static string ResolveDockerPath()
        {
            var candidates = OperatingSystem.IsWindows()
                ? new[]
                {
                    "docker",
                    @"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
                    @"C:\Program Files\Rancher Desktop\resources\win32\bin\docker.exe"
                }
                : new[] { "docker", "/usr/bin/docker", "/usr/local/bin/docker" };

            foreach (var c in candidates)
            {
                try
                {
                    var psi = new ProcessStartInfo(c, "--version")
                    {
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    using var p = Process.Start(psi);
                    if (p == null) continue;
                    p.WaitForExit(1500);
                    if (p.ExitCode == 0) return c;
                }
                catch
                {
                }
            }

            throw new InvalidOperationException(
                "Docker CLI not found. Start Docker Desktop and/or add docker.exe to PATH.");
        }
    }
}
