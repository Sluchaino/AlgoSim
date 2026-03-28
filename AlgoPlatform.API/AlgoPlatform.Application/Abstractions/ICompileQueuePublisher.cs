using AlgoPlatform.Contracts.Runner;

namespace AlgoPlatform.Application.Abstractions
{
    public interface ICompileQueuePublisher
    {
        Task PublishAsync(CompileJobMessage job, CancellationToken ct = default);
    }
}
