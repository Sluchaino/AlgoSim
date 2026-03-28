using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Repositories
{
    public sealed class ArtifactRepository : IArtifactRepository
    {
        private readonly AlgoPlatformDbContext _db;
        public ArtifactRepository(AlgoPlatformDbContext db) => _db = db;

        public Task AddAsync(Artifact entity, CancellationToken ct) =>
            _db.Artifacts.AddAsync(entity, ct).AsTask();

        public Task<Artifact?> GetAsync(string hash, CancellationToken ct) =>
            _db.Artifacts.FirstOrDefaultAsync(x => x.Hash == hash, ct);
    }
}
