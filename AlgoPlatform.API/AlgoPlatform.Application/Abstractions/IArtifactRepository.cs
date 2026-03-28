using AlgoPlatform.Domain.Models;

namespace AlgoPlatform.Application.Abstractions
{
    public interface IArtifactRepository
    {
        Task AddAsync(Artifact entity, CancellationToken ct);
        Task<Artifact?> GetAsync(string hash, CancellationToken ct);
    }
}
