using AlgoPlatform.Application.Abstractions;

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL
{
    public sealed class EfUnitOfWork : IUnitOfWork
    {
        private readonly AlgoPlatformDbContext _db;
        public EfUnitOfWork(AlgoPlatformDbContext db) => _db = db;

        public Task<int> SaveChangesAsync(CancellationToken ct) =>
            _db.SaveChangesAsync(ct);
    }
}
