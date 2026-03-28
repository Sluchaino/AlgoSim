using Microsoft.Extensions.Diagnostics.HealthChecks;
using StackExchange.Redis;

namespace AlgoPlatform.Health
{
    public sealed class RedisHealthCheck : IHealthCheck
    {
        private readonly IConnectionMultiplexer _mux;

        public RedisHealthCheck(IConnectionMultiplexer mux) => _mux = mux;

        public async Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var db = _mux.GetDatabase();
                await db.PingAsync();
                return HealthCheckResult.Healthy();
            }
            catch (Exception ex)
            {
                return HealthCheckResult.Unhealthy("Redis ping failed.", ex);
            }
        }
    }
}
