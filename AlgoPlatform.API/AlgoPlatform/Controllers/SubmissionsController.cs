using System;
using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Application.Interfaces;
using AlgoPlatform.Application.Request;
using AlgoPlatform.Contracts;
using AlgoPlatform.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace AlgoPlatform.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class SubmissionsController : ControllerBase
    {
        private readonly ISubmissionsService _submissions;
        private readonly ISubmissionStatusStore _statusStore;
        private readonly ISubmissionRepository _repo;
        private readonly IUnitOfWork _uow;
        private readonly SubmissionStatusTimeouts _timeouts;

        public SubmissionsController(
            ISubmissionsService submissions,
            ISubmissionStatusStore statusStore,
            ISubmissionRepository repo,
            IUnitOfWork uow,
            IOptions<SubmissionStatusTimeouts> timeouts)
        {
            _submissions = submissions;
            _statusStore = statusStore;
            _repo = repo;
            _uow = uow;
            _timeouts = timeouts.Value ?? new SubmissionStatusTimeouts();
        }

        // 1) Создать сабмишен и сразу запустить в очередь (через сервис)
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] SubmitCodeRequest req, CancellationToken ct)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var id = await _submissions.CreateAsync(req.Name, req.Code, req.Input, ct);

            // SPA может сразу начать poll по этому URL
            var statusUrl = Url.Action(nameof(GetStatus), new { id }) ?? $"/api/submissions/{id}/status";

            return Accepted(new SubmissionCreatedResponse(id, statusUrl));
        }

        // 2) Быстрый статус из Redis
        [HttpGet("{id:guid}/status")]
        public async Task<IActionResult> GetStatus([FromRoute] Guid id, CancellationToken ct)
        {
            var s = await _statusStore.GetAsync(id);
            if (s is null)
            {
                var fallback = await BuildStatusFromDbAsync(id, ct);
                return fallback is null ? NotFound() : Ok(fallback);
            }

            if (IsStale(s, DateTimeOffset.UtcNow))
            {
                var timedOut = await MarkTimedOutAsync(id, s.State, ct);
                return Ok(timedOut);
            }

            return Ok(s);
        }

        // 3) Финальный результат из БД (stdout и т.п.)
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetResult([FromRoute] Guid id, CancellationToken ct)
        {
            var submission = await _repo.GetAsync(id, ct);
            if (submission is null) return NotFound();

            return Ok(new SubmissionResultResponse(
                submission.Id,
                submission.Name,
                submission.Input,
                submission.Output,
                submission.Status,
                submission.ExitCode,
                submission.Error,
                submission.DurationMs));
        }

        private async Task<SubmissionStatus?> BuildStatusFromDbAsync(Guid id, CancellationToken ct)
        {
            var submission = await _repo.GetAsync(id, ct);
            if (submission is null) return null;

            var progress = string.Equals(submission.Status, "Completed", StringComparison.OrdinalIgnoreCase)
                ? (int?)100
                : null;
            var status = new SubmissionStatus(submission.Status, progress, submission.Error);
            await _statusStore.SetAsync(id, status);
            return status;
        }

        private async Task<SubmissionStatus> MarkTimedOutAsync(Guid id, string state, CancellationToken ct)
        {
            var message = $"Timed out while {state}";
            var finalStatus = new SubmissionStatus("Failed", null, message);
            await _statusStore.SetAsync(id, finalStatus);

            var submission = await _repo.GetAsync(id, ct);
            if (submission is not null
                && !string.Equals(submission.Status, "Completed", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(submission.Status, "Failed", StringComparison.OrdinalIgnoreCase))
            {
                submission.Status = "Failed";
                submission.Error = message;
                await _uow.SaveChangesAsync(ct);
            }

            return finalStatus;
        }

        private bool IsStale(SubmissionStatus status, DateTimeOffset now)
        {
            if (string.Equals(status.State, "Completed", StringComparison.OrdinalIgnoreCase)
                || string.Equals(status.State, "Failed", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var updatedAt = status.UpdatedAt ?? now;
            var timeout = GetTimeout(status.State);
            return timeout > TimeSpan.Zero && now - updatedAt > timeout;
        }

        private TimeSpan GetTimeout(string state)
        {
            var key = state?.Trim().ToLowerInvariant();
            return key switch
            {
                "queued" => TimeSpan.FromSeconds(_timeouts.QueuedSeconds),
                "compiling" => TimeSpan.FromSeconds(_timeouts.CompilingSeconds),
                "running" => TimeSpan.FromSeconds(_timeouts.RunningSeconds),
                "retrying" => TimeSpan.FromSeconds(_timeouts.RetryingSeconds),
                _ => TimeSpan.Zero
            };
        }
    }
}
