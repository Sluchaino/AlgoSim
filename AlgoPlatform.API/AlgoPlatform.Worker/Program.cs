using AlgoPlatform.Infrastructure;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddInfrastructure(builder.Configuration, includeWorker: true);

var host = builder.Build();
host.Run();
