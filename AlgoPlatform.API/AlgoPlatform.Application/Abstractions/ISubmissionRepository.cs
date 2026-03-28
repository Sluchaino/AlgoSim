using AlgoPlatform.Domain.Models;
using AlgoPlatform.Domain.Models.Metrics;

namespace AlgoPlatform.Application.Abstractions
{
    public interface ISubmissionRepository
    {
        Task AddAsync(Submission entity, CancellationToken ct);
        Task<Submission?> GetAsync(Guid id, CancellationToken ct);
        Task<IReadOnlyList<Submission>> GetByArtifactHashAsync(string artifactHash, string status, CancellationToken ct);
        Task<SubmissionMetrics> GetMetricsAsync(CancellationToken ct);
    }
}
