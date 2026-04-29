using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Domain.Models;
using AlgoPlatform.Domain.Models.Metrics;
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
            _db.Submissions.FirstOrDefaultAsync(x => x.Id == id, ct);

        public async Task<IReadOnlyList<Submission>> GetByArtifactHashAsync(
            string artifactHash,
            string status,
            CancellationToken ct) =>
            await _db.Submissions
                .Where(x => x.ArtifactHash == artifactHash && x.Status == status)
                .ToListAsync(ct);

        public async Task<SubmissionMetrics> GetMetricsAsync(CancellationToken ct)
        {
            var total = await _db.Submissions.CountAsync(ct);
            var queued = await _db.Submissions.CountAsync(
                x => x.Status == "Queued" || x.Status == "CompileQueued" || x.Status == "Compiling" || x.Status == "RunQueued",
                ct);
            var running = await _db.Submissions.CountAsync(x => x.Status == "Running", ct);
            var completed = await _db.Submissions.CountAsync(x => x.Status == "Completed", ct);
            var failed = await _db.Submissions.CountAsync(x => x.Status == "Failed", ct);

            return new SubmissionMetrics
            {
                Total = total,
                Queued = queued,
                Running = running,
                Completed = completed,
                Failed = failed
            };
        }
    }
}
