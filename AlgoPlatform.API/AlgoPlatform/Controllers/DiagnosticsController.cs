using AlgoPlatform.Infrastructure.Database.PostgreSQL;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RabbitMQ.Client;
using StackExchange.Redis;

namespace AlgoPlatform.Controllers
{
    [ApiController]
    [Route("api/diagnostics")]
    public sealed class DiagnosticsController : ControllerBase
    {
        private readonly AlgoPlatformDbContext _db;
        private readonly IConnectionMultiplexer _redis;
        private readonly IConnection _rabbit;
        private readonly IAmazonS3 _s3;
        private readonly IConfiguration _configuration;

        public DiagnosticsController(
            AlgoPlatformDbContext db,
            IConnectionMultiplexer redis,
            IConnection rabbit,
            IAmazonS3 s3,
            IConfiguration configuration)
        {
            _db = db;
            _redis = redis;
            _rabbit = rabbit;
            _s3 = s3;
            _configuration = configuration;
        }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var queues = await ReadQueuesAsync(ct);

            return Ok(new
            {
                status = queues.All(q => q.Exists) ? "ok" : "degraded",
                requiredContainerRuntime = "runsc",
                services = new
                {
                    postgres = await CheckPostgresAsync(ct),
                    redis = await CheckRedisAsync(),
                    rabbitMq = new { ok = _rabbit.IsOpen },
                    s3 = await CheckS3Async(ct)
                },
                queues
            });
        }

        private async Task<object> CheckPostgresAsync(CancellationToken ct)
        {
            try
            {
                return new { ok = await _db.Database.CanConnectAsync(ct) };
            }
            catch (Exception ex)
            {
                return new { ok = false, error = ex.Message };
            }
        }

        private async Task<object> CheckRedisAsync()
        {
            try
            {
                var latency = await _redis.GetDatabase().PingAsync();
                return new { ok = _redis.IsConnected, latencyMs = latency.TotalMilliseconds };
            }
            catch (Exception ex)
            {
                return new { ok = false, error = ex.Message };
            }
        }

        private async Task<object> CheckS3Async(CancellationToken ct)
        {
            try
            {
                var bucket = _configuration["S3:Bucket"] ?? "algosim-artifacts";
                await _s3.ListObjectsV2Async(new ListObjectsV2Request
                {
                    BucketName = bucket,
                    MaxKeys = 1
                }, ct);

                return new { ok = true, bucket };
            }
            catch (Exception ex)
            {
                return new { ok = false, error = ex.Message };
            }
        }

        private async Task<IReadOnlyList<QueueDiagnostics>> ReadQueuesAsync(CancellationToken ct)
        {
            var names = new[]
            {
                _configuration["RabbitMQ:Queue"] ?? "submissions",
                _configuration["RabbitMQ:CompileQueue"] ?? "compile",
                _configuration["RabbitMQ:CompileResultQueue"] ?? "compile-results",
                _configuration["RabbitMQ:RunQueue"] ?? "runs",
                _configuration["RabbitMQ:CancelQueue"] ?? "run-cancel",
                _configuration["RabbitMQ:ResultQueue"] ?? "run-results",
                _configuration["RabbitMQ:HeartbeatQueue"] ?? "run-heartbeats"
            };

            await using var channel = await _rabbit.CreateChannelAsync(cancellationToken: ct);
            var result = new List<QueueDiagnostics>();

            foreach (var queue in names.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    var state = await channel.QueueDeclarePassiveAsync(queue, ct);
                    result.Add(new QueueDiagnostics(queue, true, state.MessageCount, state.ConsumerCount, null));
                }
                catch (Exception ex)
                {
                    result.Add(new QueueDiagnostics(queue, false, null, null, ex.Message));
                }
            }

            return result;
        }

        private sealed record QueueDiagnostics(
            string Name,
            bool Exists,
            uint? Messages,
            uint? Consumers,
            string? Error);
    }
}
