using Microsoft.Extensions.Diagnostics.HealthChecks;
using RabbitMQ.Client;

namespace AlgoPlatform.Health
{
    public sealed class RabbitMqHealthCheck : IHealthCheck
    {
        private readonly IConnection _connection;

        public RabbitMqHealthCheck(IConnection connection) => _connection = connection;

        public Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_connection.IsOpen
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("RabbitMQ connection is closed."));
        }
    }
}
