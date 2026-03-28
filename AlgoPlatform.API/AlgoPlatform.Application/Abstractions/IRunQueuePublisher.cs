using AlgoPlatform.Contracts.Runner;

namespace AlgoPlatform.Application.Abstractions
{
    public interface IRunQueuePublisher
    {
        Task PublishAsync(RunJobMessage job, CancellationToken ct = default);
    }
}
