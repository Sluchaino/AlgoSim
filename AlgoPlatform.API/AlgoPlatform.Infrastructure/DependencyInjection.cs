using AlgoPlatform.Application.Abstractions;
using Amazon.S3;
using AlgoPlatform.Infrastructure.Artifacts;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using AlgoPlatform.Infrastructure.Database.PostgreSQL.Repositories;
using AlgoPlatform.Infrastructure.Storage;
using AlgoPlatform.Infrastructure.Database.Redis.Repositories;
using AlgoPlatform.Infrastructure.RabbitMQ.HostedServices;
using AlgoPlatform.Infrastructure.RabbitMQ.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using StackExchange.Redis;
using System.Collections.Generic;

namespace AlgoPlatform.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddInfrastructure(
            this IServiceCollection services,
            IConfiguration configuration,
            bool includeWorker = false)
        {
            // ---------- PostgreSQL + EF ----------
            services.AddDbContext<AlgoPlatformDbContext>(opt =>
                opt.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));

            services.AddScoped<IAlgorithmsRepository, AlgorithmsRepository>();
            services.AddScoped<ISubmissionRepository, SubmissionRepository>();
            services.AddScoped<IArtifactRepository, ArtifactRepository>();
            services.AddSingleton<IArtifactHasher, Sha256ArtifactHasher>();
            services.AddScoped<IUnitOfWork, EfUnitOfWork>();

            // ---------- Redis ----------
            var redisConn = configuration["Redis:Connection"]
                            ?? configuration.GetConnectionString("Redis")
                            ?? "localhost:6379,password=devpass,abortConnect=false";

            services.AddSingleton<IConnectionMultiplexer>(_ =>
                ConnectionMultiplexer.Connect(redisConn));

            // IDatabase - thread-safe, можно смело шарить
            services.AddSingleton(sp =>
                sp.GetRequiredService<IConnectionMultiplexer>().GetDatabase());

            services.AddSingleton<ISubmissionStatusStore, RedisSubmissionStatusStore>();
            // ---------- S3 Storage ----------
            services.AddSingleton<IAmazonS3>(_ => S3ArtifactStorage.BuildClient(configuration));
            services.AddSingleton<IArtifactStorage, S3ArtifactStorage>();

            // ---------- RabbitMQ ----------
            var host = configuration["RabbitMQ:Host"] ?? "localhost";
            var user = configuration["RabbitMQ:User"] ?? "guest";
            var pass = configuration["RabbitMQ:Pass"] ?? "guest";
            var vhost = configuration["RabbitMQ:VHost"] ?? "/";

            services.AddSingleton<ConnectionFactory>(_ => new ConnectionFactory
            {
                HostName = host,
                UserName = user,
                Password = pass,
                VirtualHost = vhost,
                AutomaticRecoveryEnabled = true,
                TopologyRecoveryEnabled = true
            });

            // ВАЖНО: только CreateConnectionAsync().GetAwaiter().GetResult()
            services.AddSingleton<IConnection>(sp =>
            {
                var factory = sp.GetRequiredService<ConnectionFactory>();
                var loggerFactory = sp.GetService<ILoggerFactory>();
                var logger = loggerFactory?.CreateLogger("RabbitMqConnection");

                const int maxAttempts = 10;
                var delay = TimeSpan.FromSeconds(2);

                for (var attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    try
                    {
                        logger?.LogInformation(
                            "Connecting to RabbitMQ at {Host} (attempt {Attempt}/{MaxAttempts})",
                            factory.HostName, attempt, maxAttempts);

                        // тут мы реально получаем IConnection из ValueTask<IConnection>
                        return factory.CreateConnectionAsync().GetAwaiter().GetResult();
                    }
                    catch (Exception ex) when (attempt < maxAttempts)
                    {
                        logger?.LogWarning(
                            ex,
                            "RabbitMQ not ready yet (attempt {Attempt}/{MaxAttempts}), retrying in {Delay}s",
                            attempt, maxAttempts, delay.TotalSeconds);

                        Thread.Sleep(delay);
                    }
                }

                // последняя попытка без try/catch — если тут упадёт, пусть процесс валится
                return factory.CreateConnectionAsync().GetAwaiter().GetResult();
            });

            // IChannel (как было)
            services.AddSingleton<IChannel>(sp =>
            {
                var conn = sp.GetRequiredService<IConnection>();
                var ch = conn.CreateChannelAsync().GetAwaiter().GetResult();

                var queue = configuration["RabbitMQ:Queue"] ?? "submissions";
                var retryDelaySeconds = configuration.GetValue<int?>("RabbitMQ:RetryDelaySeconds") ?? 5;

                void DeclareQueueWithRetry(string baseQueue)
                {
                    var retryQueue = baseQueue + ".retry";
                    var deadQueue = baseQueue + ".dead";

                    var mainArgs = new Dictionary<string, object?>
                    {
                        ["x-dead-letter-exchange"] = "",
                        ["x-dead-letter-routing-key"] = deadQueue
                    };

                    var retryArgs = new Dictionary<string, object?>
                    {
                        ["x-message-ttl"] = retryDelaySeconds * 1000,
                        ["x-dead-letter-exchange"] = "",
                        ["x-dead-letter-routing-key"] = baseQueue
                    };

                    ch.QueueDeclareAsync(
                        queue: baseQueue,
                        durable: true,
                        exclusive: false,
                        autoDelete: false,
                        arguments: mainArgs
                    ).GetAwaiter().GetResult();

                    ch.QueueDeclareAsync(
                        queue: retryQueue,
                        durable: true,
                        exclusive: false,
                        autoDelete: false,
                        arguments: retryArgs
                    ).GetAwaiter().GetResult();

                    ch.QueueDeclareAsync(
                        queue: deadQueue,
                        durable: true,
                        exclusive: false,
                        autoDelete: false,
                        arguments: null
                    ).GetAwaiter().GetResult();
                }

                DeclareQueueWithRetry(queue);

                var runQueue = configuration["RabbitMQ:RunQueue"] ?? "runs";
                DeclareQueueWithRetry(runQueue);

                var resultQueue = configuration["RabbitMQ:ResultQueue"] ?? "run-results";
                DeclareQueueWithRetry(resultQueue);

                var compileQueue = configuration["RabbitMQ:CompileQueue"] ?? "compile";
                DeclareQueueWithRetry(compileQueue);

                var compileResultQueue = configuration["RabbitMQ:CompileResultQueue"] ?? "compile-results";
                DeclareQueueWithRetry(compileResultQueue);

                return ch;
            });

            services.AddSingleton<ISubmissionQueuePublisher>(sp =>
                new RabbitMqSubmissionPublisher(
                    sp.GetRequiredService<IChannel>(),
                    configuration["RabbitMQ:Queue"] ?? "submissions"));
            services.AddSingleton<ICompileQueuePublisher>(sp =>
                new RabbitMqCompilePublisher(
                    sp.GetRequiredService<IChannel>(),
                    configuration["RabbitMQ:CompileQueue"] ?? "compile"));

            services.AddSingleton<IRunQueuePublisher>(sp =>
                new RabbitMqRunPublisher(
                    sp.GetRequiredService<IChannel>(),
                    configuration["RabbitMQ:RunQueue"] ?? "runs"));

            if (includeWorker)
            {
                services.AddHostedService<RabbitMqExecutorService>();
                services.AddHostedService<RabbitMqResultService>();
                services.AddHostedService<RabbitMqCompileResultService>();
                services.AddHostedService<RabbitMqHeartbeatService>();
            }

            return services;
        }
    }
}

