using Amazon.S3;
using AlgoPlatform.Compiler;
using AlgoPlatform.Compiler.Execution;
using AlgoPlatform.Compiler.RabbitMQ;
using AlgoPlatform.Compiler.Storage;
using RabbitMQ.Client;
using System.Diagnostics;

var builder = Host.CreateApplicationBuilder(args);

var options = builder.Configuration.GetSection("Compiler").Get<CompilerOptions>() ?? new CompilerOptions();
options.ContainerRuntime = "runsc";
RequireDockerRuntime(options.ContainerRuntime, "Compiler");
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
startupLogger.LogInformation("Compiler starting. Required container runtime: {Runtime}", options.ContainerRuntime);
startupLogger.LogInformation(
    "S3 config: endpoint={Endpoint}, accessKey={AccessKey}, usePathStyle={UsePathStyle}",
    builder.Configuration["S3:Endpoint"],
    builder.Configuration["S3:AccessKey"],
    builder.Configuration["S3:UsePathStyle"]);

host.Run();

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
