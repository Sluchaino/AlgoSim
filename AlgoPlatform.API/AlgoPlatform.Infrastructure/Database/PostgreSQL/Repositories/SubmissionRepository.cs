using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Domain.Models;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AlgoPlatform.Infrastructure.Database.PostgreSQL.Repositories
{
    public sealed class SubmissionRepository : ISubmissionRepository
    {
        private readonly AlgoPlatformDbContext _db;
        public SubmissionRepository(AlgoPlatformDbContext db) => _db = db;

        public Task AddAsync(Submission entity, CancellationToken ct) =>
            _db.Submissions.AddAsync(entity, ct).AsTask();

        public Task<Submission?> GetAsync(Guid id, CancellationToken ct) =>
            _db.Submissions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
    }
}
