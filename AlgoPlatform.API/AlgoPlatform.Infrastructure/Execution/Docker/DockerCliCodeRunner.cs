using AlgoPlatform.Application.Abstractions;
using System.Diagnostics;
using System.Text;

namespace AlgoPlatform.Infrastructure.Execution.Docker
{
    public sealed class DockerCliCodeRunner : ICodeRunner
    {
        private const string Image = "mcr.microsoft.com/dotnet/sdk:9.0-alpine";

        public async Task<(int ExitCode, string Stdout, string Stderr)> RunAsync(
            string code,
            string? input,
            CancellationToken ct)
        {
            // --- подготовка нагрузки (код, csproj, AlgoTracing.dll) ---

            // C#-код пользователя
            var codeB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(code ?? string.Empty));

            // Тот же csproj, что и в Program.cs
            var csprojXml = """
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="AlgoTracing">
      <HintPath>/opt/algotracing/AlgoTracing.dll</HintPath>
      <Private>true</Private>
    </Reference>
  </ItemGroup>
</Project>
""";
            var csprojB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(csprojXml));

            // Библиотека AlgoTracing.dll лежит рядом с API
            var algoDllPath = Path.Combine(AppContext.BaseDirectory, "AlgoTracing.dll");
            if (!File.Exists(algoDllPath))
            {
                throw new FileNotFoundException(
                    "AlgoTracing.dll не найден рядом с приложением API. " +
                    "Убедись, что csproj API имеет ProjectReference на AlgoTracing.",
                    algoDllPath);
            }

            var algoDllBytes = await File.ReadAllBytesAsync(algoDllPath, ct);
            var algoDllB64 = Convert.ToBase64String(algoDllBytes);

            // Входные данные (опционально)
            var inputB64 = input is null
                ? string.Empty
                : Convert.ToBase64String(Encoding.UTF8.GetBytes(input));

            var dockerPath = ResolveDockerPath();
            var dockerConfig = EnsureMinimalDockerConfig();

            // --- shell-скрипт внутри контейнера ---
            // 1. создаём /tmp/app и /opt/algotracing
            // 2. разворачиваем App.csproj, Program.cs и AlgoTracing.dll
            // 3. если есть INPUT_B64 — пишем input.txt
            // 4. запускаем dotnet run (с редиректом stdin из input.txt, если он есть)
            var sh =
                "set -euo pipefail; " +
                "mkdir -p /tmp/app /opt/algotracing && " +
                "printf \"%s\" \"$CSPROJ_B64\"   | base64 -d > /tmp/app/App.csproj && " +
                "printf \"%s\" \"$CODE_B64\"     | base64 -d > /tmp/app/Program.cs && " +
                "printf \"%s\" \"$ALGO_DLL_B64\" | base64 -d > /opt/algotracing/AlgoTracing.dll && " +
                "if [ -n \"${INPUT_B64:-}\" ]; then printf \"%s\" \"$INPUT_B64\" | base64 -d > /tmp/app/input.txt; fi && " +
                "cd /tmp/app && " +
                "if [ -f input.txt ]; then dotnet run -c Release < input.txt; else dotnet run -c Release; fi";

            var args =
                $"run --rm --pull=missing --network none " +
                $"--cpus 0.5 --memory 256m --pids-limit 64 " +
                $"-e CODE_B64 -e CSPROJ_B64 -e ALGO_DLL_B64 -e INPUT_B64 " +
                $"{Image} sh -lc \"{sh}\"";

            var psi = new ProcessStartInfo(dockerPath, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            // Чистая конфигурация Docker, не зависящая от пользователя
            psi.Environment["DOCKER_CONFIG"] = dockerConfig;

            psi.Environment["CODE_B64"] = codeB64;
            psi.Environment["CSPROJ_B64"] = csprojB64;
            psi.Environment["ALGO_DLL_B64"] = algoDllB64;
            psi.Environment["INPUT_B64"] = inputB64;

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = false };

            var stdoutBuilder = new StringBuilder();
            var stderrBuilder = new StringBuilder();

            proc.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                stdoutBuilder.AppendLine(e.Data);
            };
            proc.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                stderrBuilder.AppendLine(e.Data);
            };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            // --- таймаут + отмена через CancellationToken ---

            var waitTask = proc.WaitForExitAsync();
            var timeoutTask = Task.Delay(TimeSpan.FromSeconds(120));
            var cancelTask = Task.Delay(Timeout.InfiniteTimeSpan, ct);

            var finished = await Task.WhenAny(waitTask, timeoutTask, cancelTask);

            if (finished == timeoutTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
                stderrBuilder.AppendLine("Execution timed out after 120 seconds.");
            }
            else if (finished == cancelTask)
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* ignore */ }
                // Пробрасываем отмену наверх
                throw new OperationCanceledException(ct);
            }

            // Дожидаемся фактического завершения процесса (после Kill тоже)
            await waitTask;

            var stdout = stdoutBuilder.ToString();
            var stderr = stderrBuilder.ToString();

            return (proc.ExitCode, stdout, stderr);
        }

        // --- утилиты (1:1 с Program.cs) ---

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
                    // ignore and try next
                }
            }

            throw new InvalidOperationException(
                "Docker CLI не найден. Запустите Docker Desktop и/или добавьте docker.exe в PATH.");
        }
    }
}