using AlgoPlatform.Application.Abstractions;
using System.Collections.Concurrent;

namespace AlgoPlatform.Tests.Integration
{
    public sealed class InMemorySubmissionStatusStore : ISubmissionStatusStore
    {
        private readonly ConcurrentDictionary<Guid, SubmissionStatus> _store = new();

        public Task SetAsync(Guid id, SubmissionStatus status, TimeSpan? ttl = null)
        {
            _store[id] = status with { UpdatedAt = DateTimeOffset.UtcNow };
            return Task.CompletedTask;
        }

        public Task<SubmissionStatus?> GetAsync(Guid id)
        {
            return Task.FromResult(_store.TryGetValue(id, out var s) ? s : null);
        }
    }
}
