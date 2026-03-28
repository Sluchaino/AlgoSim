using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Application.Interfaces;
using AlgoPlatform.Domain.Models;

namespace AlgoPlatform.Application.Services
{
    public sealed class SubmissionsService : ISubmissionsService
    {
        private readonly ISubmissionRepository _repo;
        private readonly IUnitOfWork _uow;
        private readonly ISubmissionStatusStore _status;
        private readonly ISubmissionQueuePublisher _queue;

        public SubmissionsService(
            ISubmissionRepository repo,
            IUnitOfWork uow,
            ISubmissionStatusStore status,
            ISubmissionQueuePublisher queue)
        {
            _repo = repo;
            _uow = uow;
            _status = status;
            _queue = queue;
        }

        public async Task<Guid> CreateAsync(string name, string code, string input, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Name is required.", nameof(name));
            if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("Code is required.", nameof(code));
            if (string.IsNullOrWhiteSpace(input)) throw new ArgumentException("Input is required.", nameof(input));

            var entity = new Submission
            {
                Id = Guid.NewGuid(),
                Name = name.Trim(),
                Code = code,
                Input = input,
                Output = string.Empty,
                Status = "Queued",
                ExitCode = null,
                Error = null,
                DurationMs = null
            };

            await _repo.AddAsync(entity, ct);
            await _uow.SaveChangesAsync(ct);

            await _status.SetAsync(entity.Id, new SubmissionStatus("Queued"));
            await _queue.PublishAsync(entity.Id, ct);  

            return entity.Id;
        }
    }
}
