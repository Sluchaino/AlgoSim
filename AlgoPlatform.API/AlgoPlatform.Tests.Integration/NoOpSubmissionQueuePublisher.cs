using AlgoPlatform.Application.Abstractions;

namespace AlgoPlatform.Tests.Integration
{
    public sealed class NoOpSubmissionQueuePublisher : ISubmissionQueuePublisher
    {
        public Task PublishAsync(Guid submissionId, CancellationToken ct = default)
            => Task.CompletedTask;
    }
}
