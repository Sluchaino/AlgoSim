using AlgoPlatform.Application.Abstractions;

namespace AlgoPlatform.Tests.Integration
{
    public sealed class NoOpRunCancelQueuePublisher : IRunCancelQueuePublisher
    {
        public Task PublishAsync(Guid submissionId, CancellationToken ct = default)
            => Task.CompletedTask;
    }
}

