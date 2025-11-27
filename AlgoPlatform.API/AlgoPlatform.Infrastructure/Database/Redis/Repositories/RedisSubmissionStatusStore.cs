using AlgoPlatform.Application.Abstractions;
using StackExchange.Redis;

namespace AlgoPlatform.Infrastructure.Database.Redis.Repositories
{
    public sealed class RedisSubmissionStatusStore : ISubmissionStatusStore
    {
        private readonly IDatabase _db;
        public RedisSubmissionStatusStore(IDatabase db) => _db = db;
        private static string Key(Guid id) => $"sub:{id}:status";

        public Task SetAsync(Guid id, SubmissionStatus s, TimeSpan? ttl = null) =>
            _db.StringSetAsync(Key(id),
                System.Text.Json.JsonSerializer.Serialize(s with { UpdatedAt = DateTimeOffset.UtcNow }),
                ttl ?? TimeSpan.FromDays(1));

        public async Task<SubmissionStatus?> GetAsync(Guid id)
        {
            var val = await _db.StringGetAsync(Key(id));
            return val.IsNullOrEmpty ? null
                : System.Text.Json.JsonSerializer.Deserialize<SubmissionStatus>(val!);
        }
    }
}
