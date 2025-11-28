using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using AlgoPlatform.Infrastructure.Database.PostgreSQL.Repositories;
using AlgoPlatform.Infrastructure.Database.Redis.Repositories;
using AlgoPlatform.Infrastructure.Execution.Docker;
using AlgoPlatform.Infrastructure.RabbitMQ.HostedServices;
using AlgoPlatform.Infrastructure.RabbitMQ.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RabbitMQ.Client;
using StackExchange.Redis;

namespace AlgoPlatform.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
        {
            // DbContext
            services.AddDbContext<AlgoPlatformDbContext>(opt =>
                opt.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));

            // Репозитории
            services.AddScoped<IAlgorithmsRepository, AlgorithmsRepository>();
            services.AddScoped<ISubmissionRepository, SubmissionRepository>();
            services.AddScoped<IUnitOfWork, EfUnitOfWork>();

            // Redis
            var redisConn = configuration["Redis:Connection"]
                         ?? configuration.GetConnectionString("Redis")
                         ?? "localhost:6379,password=devpass,abortConnect=false";

            services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConn));
            services.AddSingleton<IDatabase>(sp => sp.GetRequiredService<IConnectionMultiplexer>().GetDatabase());
            services.AddSingleton<ISubmissionStatusStore, RedisSubmissionStatusStore>();

            // RabbitMQ
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

            // IConnection (CreateConnectionAsync -> ждём синхронно)
            services.AddSingleton<IConnection>(sp =>
            {
                var factory = sp.GetRequiredService<ConnectionFactory>();
                return factory.CreateConnectionAsync().GetAwaiter().GetResult();
            });

            // IChannel (CreateChannelAsync + QueueDeclareAsync -> ждём синхронно)
            services.AddSingleton<IChannel>(sp =>
            {
                var conn = sp.GetRequiredService<IConnection>();
                var ch = conn.CreateChannelAsync().GetAwaiter().GetResult();

                var queue = configuration["RabbitMQ:Queue"] ?? "submissions";
                ch.QueueDeclareAsync(
                    queue: queue,
                    durable: true,
                    exclusive: false,
                    autoDelete: false,
                    arguments: null
                ).GetAwaiter().GetResult();

                return ch;
            });

            services.AddSingleton<ISubmissionQueuePublisher>(sp =>
                new RabbitMqSubmissionPublisher(
                    sp.GetRequiredService<IChannel>(),
                    configuration["RabbitMQ:Queue"] ?? "submissions"));

            // Раннер и консюмер
            services.AddSingleton<ICodeRunner, DockerCliCodeRunner>();
            services.AddHostedService<RabbitMqExecutorService>();

            return services;
        }
    }
}