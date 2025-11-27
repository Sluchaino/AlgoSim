using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using AlgoPlatform.Infrastructure.Database.PostgreSQL.Repositories;
using AlgoPlatform.Infrastructure.Database.Redis.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;
namespace AlgoPlatform.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
        {
            // DbContext
            services.AddDbContext<AlgoPlatformDbContext>(opt => opt.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));

            // Репозитории
            services.AddScoped<IAlgorithmsRepository, AlgorithmsRepository>();
            services.AddScoped<ISubmissionRepository, SubmissionRepository>();
            services.AddScoped<IUnitOfWork, EfUnitOfWork>();

            // Redis
            var conn = configuration["Redis:Connection"]
                   ?? configuration.GetConnectionString("Redis")
                   ?? "localhost:6379,password=devpass,abortConnect=false";

            services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(conn));
            services.AddSingleton<IDatabase>(sp => sp.GetRequiredService<IConnectionMultiplexer>().GetDatabase());

            // Хранилище статусов
            services.AddSingleton<ISubmissionStatusStore, RedisSubmissionStatusStore>();

            return services;
        }
    }
}
