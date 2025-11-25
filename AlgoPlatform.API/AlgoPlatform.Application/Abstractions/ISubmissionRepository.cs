using AlgoPlatform.Domain.Models;

namespace AlgoPlatform.Application.Abstractions
{
    public interface ISubmissionRepository
    {
        Task AddAsync(Submission entity, CancellationToken ct);
        Task<Submission?> GetAsync(Guid id, CancellationToken ct);
    }
}
