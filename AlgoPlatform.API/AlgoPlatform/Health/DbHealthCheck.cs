using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace AlgoPlatform.Health
{
    public sealed class DbHealthCheck : IHealthCheck
    {
        private readonly AlgoPlatformDbContext _db;

        public DbHealthCheck(AlgoPlatformDbContext db) => _db = db;

        public async Task<HealthCheckResult> CheckHealthAsync(
            HealthCheckContext context,
            CancellationToken cancellationToken = default)
        {
            var canConnect = await _db.Database.CanConnectAsync(cancellationToken);
            return canConnect
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("Database connection failed.");
        }
    }
}
