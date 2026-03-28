using System.Diagnostics;
using System.Globalization;
using System.Text;
using AlgoPlatform.Compiler;
using AlgoTracing;

namespace AlgoPlatform.Compiler.Execution
{
    public sealed class DockerCliCodeCompiler
    {
        private const string Image = "mcr.microsoft.com/dotnet/sdk:10.0-alpine";
        private readonly CompilerOptions _options;

        public DockerCliCodeCompiler(CompilerOptions options)
        {
            _options = options;
        }

        public async Task<(bool Success, byte[]? Artifact, string? Error, long DurationMs)> CompileAsync(
            string code,
            CancellationToken ct)
        {
            var timeout = TimeSpan.FromSeconds(_options.TimeoutSeconds);

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
                    "AlgoTracing.dll not found next to the compiler application.",
                    algoDllPath);
            }

            var algoDllBytes = await File.ReadAllBytesAsync(algoDllPath, ct);
            var algoDllB64 = Convert.ToBase64String(algoDllBytes);

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
                "cd /tmp/app && " +
                "dotnet build -c Release -o /tmp/out -p:DisableWorkloadResolver=true 1>&2 && " +
                "tar -cz -C /tmp/out .";

            var cpuLimit = _options.CpuLimit.ToString(CultureInfo.InvariantCulture);
            var args =
                $"run --rm --pull=missing {runtimeArg}--network none --read-only " +
                $"--tmpfs /tmp:rw,size=256m,mode=1777,exec --tmpfs /var/tmp:rw,size=64m,mode=1777,exec " +
                $"--cap-drop ALL --security-opt no-new-privileges --user 65532:65532 " +
                $"--cpus {cpuLimit} --memory {_options.MemoryMb}m --pids-limit {_options.PidsLimit} " +
                $"-e CODE_B64 -e CSPROJ_B64 -e ALGO_DLL_B64 " +
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

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = false };
            using var stdoutMs = new MemoryStream();

            var sw = Stopwatch.StartNew();
            proc.Start();

            var copyTask = proc.StandardOutput.BaseStream.CopyToAsync(stdoutMs, ct);
            var stderrTask = proc.StandardError.ReadToEndAsync();

            var waitTask = proc.WaitForExitAsync(ct);
            var timeoutTask = Task.Delay(timeout, ct);

            var finished = await Task.WhenAny(waitTask, timeoutTask);
            if (finished == timeoutTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                sw.Stop();
                return (false, null, $"Compilation timed out after {timeout.TotalSeconds} seconds.", (long)sw.Elapsed.TotalMilliseconds);
            }

            await waitTask;
            await copyTask;
            var stderr = await stderrTask;
            sw.Stop();

            var trimmedError = TrimError(stderr, _options.MaxErrorChars);

            if (proc.ExitCode != 0)
            {
                return (false, null, string.IsNullOrWhiteSpace(trimmedError) ? "Compilation failed." : trimmedError, (long)sw.Elapsed.TotalMilliseconds);
            }

            if (stdoutMs.Length == 0)
            {
                return (false, null, "Compilation produced empty artifact.", (long)sw.Elapsed.TotalMilliseconds);
            }

            return (true, stdoutMs.ToArray(), null, (long)sw.Elapsed.TotalMilliseconds);
        }

        private static string TrimError(string stderr, int maxChars)
        {
            if (string.IsNullOrWhiteSpace(stderr)) return stderr;
            if (stderr.Length <= maxChars) return stderr.Trim();
            return stderr.Substring(0, maxChars).TrimEnd() + "\n--OUTPUT_TRUNCATED--";
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
