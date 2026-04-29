namespace AlgoPlatform.Application.Abstractions
{
    public interface IRunCancelQueuePublisher
    {
        Task PublishAsync(Guid submissionId, CancellationToken ct = default);
    }
}

