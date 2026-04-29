using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Domain.Models;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RabbitMQ.Client;
using StackExchange.Redis;

namespace AlgoPlatform.Tests.Integration
{
    public sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Test");

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<DbContextOptions<AlgoPlatformDbContext>>();
                services.RemoveAll<AlgoPlatformDbContext>();

                var npgsqlDescriptors = services
                    .Where(d =>
                        (d.ServiceType.Namespace?.StartsWith("Npgsql.EntityFrameworkCore.PostgreSQL") ?? false) ||
                        (d.ImplementationType?.Namespace?.StartsWith("Npgsql.EntityFrameworkCore.PostgreSQL") ?? false))
                    .ToList();

                foreach (var descriptor in npgsqlDescriptors)
                {
                    services.Remove(descriptor);
                }
                RemoveService<IConnectionMultiplexer>(services);
                RemoveService<IConnection>(services);
                RemoveService<IChannel>(services);
                RemoveService<ISubmissionStatusStore>(services);
                RemoveService<ISubmissionQueuePublisher>(services);
                RemoveService<IRunCancelQueuePublisher>(services);

                var inMemoryProvider = new ServiceCollection()
                    .AddEntityFrameworkInMemoryDatabase()
                    .BuildServiceProvider();

                services.AddScoped(sp =>
                {
                    var options = new DbContextOptionsBuilder<AlgoPlatformDbContext>()
                        .UseInMemoryDatabase("AlgoPlatformTestDb")
                        .UseInternalServiceProvider(inMemoryProvider)
                        .Options;

                    return new AlgoPlatformDbContext(options);
                });

                services.AddSingleton<ISubmissionStatusStore, InMemorySubmissionStatusStore>();
                services.AddSingleton<ISubmissionQueuePublisher, NoOpSubmissionQueuePublisher>();
                services.AddSingleton<IRunCancelQueuePublisher, NoOpRunCancelQueuePublisher>();

                using var scope = services.BuildServiceProvider().CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AlgoPlatformDbContext>();
                db.Database.EnsureCreated();

                if (!db.Algorithms.Any())
                {
                    db.Algorithms.AddRange(new[]
                    {
                        new Algorithm { Id = 2, Name = "Selection sort", Description = "Seed" },
                        new Algorithm { Id = 3, Name = "Insertion sort", Description = "Seed" },
                        new Algorithm { Id = 5, Name = "Quick sort", Description = "Seed" },
                        new Algorithm { Id = 6, Name = "DFS", Description = "Seed" },
                        new Algorithm { Id = 7, Name = "BFS", Description = "Seed" }
                    });
                    db.SaveChanges();
                }
            });
        }

        private static void RemoveService<T>(IServiceCollection services)
        {
            var descriptor = services.SingleOrDefault(d => d.ServiceType == typeof(T));
            if (descriptor != null)
            {
                services.Remove(descriptor);
            }
        }
    }
}
