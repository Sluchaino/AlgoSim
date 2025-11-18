using AlgoPlatform.Application.Interfaces;
using AlgoPlatform.Application.Services;
using Microsoft.Extensions.DependencyInjection;
namespace AlgoPlatform.Application
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddApplication(this IServiceCollection services)
        {
            services.AddScoped<IAlgorithmsService, AlgorithmsService>();
            return services;
        }
    }
}
