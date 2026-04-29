using Amazon.S3;
using AlgoPlatform.Compiler;
using AlgoPlatform.Compiler.Execution;
using AlgoPlatform.Compiler.RabbitMQ;
using AlgoPlatform.Compiler.Storage;
using RabbitMQ.Client;
using System.Diagnostics;

var builder = Host.CreateApplicationBuilder(args);

var options = builder.Configuration.GetSection("Compiler").Get<CompilerOptions>() ?? new CompilerOptions();
var requestedRuntime = options.ContainerRuntime;
var runtimeFallback = false;
if (!string.IsNullOrWhiteSpace(requestedRuntime) && !DockerRuntimeExists(requestedRuntime))
{
    options.ContainerRuntime = string.Empty;
    runtimeFallback = true;
}
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<DockerCliCodeCompiler>();

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

builder.Services.AddHostedService<RabbitMqCompileWorker>();

var host = builder.Build();

var startupLogger = host.Services.GetRequiredService<ILogger<Program>>();
var startupRuntime = string.IsNullOrWhiteSpace(options.ContainerRuntime) ? "default" : options.ContainerRuntime;
startupLogger.LogInformation("Compiler starting. Container runtime: {Runtime}", startupRuntime);
if (runtimeFallback)
{
    startupLogger.LogWarning(
        "Requested runtime '{Runtime}' is unavailable. Fallback to default runtime is active.",
        requestedRuntime);
}
startupLogger.LogInformation(
    "S3 config: endpoint={Endpoint}, accessKey={AccessKey}, usePathStyle={UsePathStyle}",
    builder.Configuration["S3:Endpoint"],
    builder.Configuration["S3:AccessKey"],
    builder.Configuration["S3:UsePathStyle"]);

host.Run();

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
