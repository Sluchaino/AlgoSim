using Amazon.S3;
using AlgoPlatform.Compiler;
using AlgoPlatform.Compiler.Execution;
using AlgoPlatform.Compiler.RabbitMQ;
using AlgoPlatform.Compiler.Storage;
using RabbitMQ.Client;

var builder = Host.CreateApplicationBuilder(args);

var options = builder.Configuration.GetSection("Compiler").Get<CompilerOptions>() ?? new CompilerOptions();
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
startupLogger.LogInformation(
    "S3 config: endpoint={Endpoint}, accessKey={AccessKey}, usePathStyle={UsePathStyle}",
    builder.Configuration["S3:Endpoint"],
    builder.Configuration["S3:AccessKey"],
    builder.Configuration["S3:UsePathStyle"]);

host.Run();
