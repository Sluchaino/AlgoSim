using Amazon.S3;
using AlgoPlatform.Contracts.Runner;
using AlgoPlatform.Runner;
using AlgoPlatform.Runner.Execution;
using AlgoPlatform.Runner.RabbitMQ;
using AlgoPlatform.Runner.Storage;
using RabbitMQ.Client;
using System.Diagnostics;

var builder = WebApplication.CreateBuilder(args);

var options = builder.Configuration.GetSection("Runner").Get<RunnerOptions>() ?? new RunnerOptions();
options.ContainerRuntime = "runsc";
RequireDockerRuntime(options.ContainerRuntime, "Runner");
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<DockerCliCodeRunner>();
builder.Services.AddSingleton(new SemaphoreSlim(Math.Max(1, options.MaxConcurrent)));

builder.Services.AddSingleton<IAmazonS3>(_ => S3ArtifactStorage.BuildClient(builder.Configuration));
builder.Services.AddSingleton<S3ArtifactStorage>();

var mqHost = builder.Configuration["RabbitMQ:Host"] ?? "localhost";
var mqUser = builder.Configuration["RabbitMQ:User"] ?? "guest";
var mqPass = builder.Configuration["RabbitMQ:Pass"] ?? "guest";
var mqVhost = builder.Configuration["RabbitMQ:VHost"] ?? "/";

builder.Services.AddSingleton<ConnectionFactory>(_ => new ConnectionFactory
{
    HostName = mqHost,
    UserName = mqUser,
    Password = mqPass,
    VirtualHost = mqVhost,
    AutomaticRecoveryEnabled = true,
    TopologyRecoveryEnabled = true
});

builder.Services.AddSingleton<IConnection>(sp =>
{
    var factory = sp.GetRequiredService<ConnectionFactory>();
    const int maxAttempts = 10;
    var delay = TimeSpan.FromSeconds(2);

    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            return factory.CreateConnectionAsync().GetAwaiter().GetResult();
        }
        catch (Exception) when (attempt < maxAttempts)
        {
            Thread.Sleep(delay);
        }
    }

    return factory.CreateConnectionAsync().GetAwaiter().GetResult();
});

builder.Services.AddHostedService<RabbitMqRunWorker>();

var app = builder.Build();

var startupLogger = app.Services.GetRequiredService<ILogger<Program>>();
startupLogger.LogInformation("Runner starting. Required container runtime: {Runtime}", options.ContainerRuntime);

app.MapGet("/health", (RunnerOptions runnerOptions) =>
{
    var runtime = string.IsNullOrWhiteSpace(runnerOptions.ContainerRuntime) ? "default" : runnerOptions.ContainerRuntime;
    return Results.Ok(new { status = "ok", runtime });
});

app.MapPost("/run", async (
    RunCodeRequest req,
    DockerCliCodeRunner runner,
    SemaphoreSlim gate,
    RunnerOptions runnerOptions,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.Code))
    {
        return Results.BadRequest(new { error = "Code is required." });
    }

    await gate.WaitAsync(ct);
    try
    {
        var timeout = req.TimeoutSeconds is > 0 ? Math.Min(req.TimeoutSeconds.Value, runnerOptions.TimeoutSeconds) : runnerOptions.TimeoutSeconds;
        var maxOutput = req.MaxOutputChars is > 0 ? Math.Min(req.MaxOutputChars.Value, runnerOptions.MaxOutputChars) : runnerOptions.MaxOutputChars;

        var (exitCode, stdout, stderr, durationMs, timedOut) =
            await runner.RunAsync(req.Code, req.Input, timeout, maxOutput, ct);

        return Results.Ok(new RunCodeResponse(exitCode, stdout, stderr, durationMs, timedOut));
    }
    finally
    {
        gate.Release();
    }
});

app.Run();

static void RequireDockerRuntime(string runtimeName, string serviceName)
{
    if (!DockerRuntimeExists(runtimeName))
    {
        throw new InvalidOperationException(
            $"{serviceName} requires Docker runtime '{runtimeName}'. Configure gVisor/runsc in Docker before starting the service.");
    }
}

static bool DockerRuntimeExists(string runtimeName)
{
    try
    {
        var psi = new ProcessStartInfo("docker", "info --format \"{{json .Runtimes}}\"")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var p = Process.Start(psi);
        if (p is null) return false;

        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(5000);

        if (p.ExitCode != 0) return false;
        if (string.IsNullOrWhiteSpace(output)) return false;

        return output.Contains($"\"{runtimeName}\"", StringComparison.OrdinalIgnoreCase);
    }
    catch
    {
        return false;
    }
}
