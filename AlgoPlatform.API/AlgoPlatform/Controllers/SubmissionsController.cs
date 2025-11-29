using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Application.Interfaces;
using AlgoPlatform.Application.Request;
using Microsoft.AspNetCore.Mvc;

namespace AlgoPlatform.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class SubmissionsController : ControllerBase
    {
        private readonly ISubmissionsService _submissions;
        private readonly ISubmissionStatusStore _statusStore;
        private readonly ISubmissionRepository _repo;

        public SubmissionsController(
            ISubmissionsService submissions,
            ISubmissionStatusStore statusStore,
            ISubmissionRepository repo)
        {
            _submissions = submissions;
            _statusStore = statusStore;
            _repo = repo;
        }

        // 1) Создать сабмишен и сразу запустить в очередь (через сервис)
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] SubmitCodeRequest req, CancellationToken ct)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var id = await _submissions.CreateAsync(req.Name, req.Code, req.Input, ct);

            // SPA может сразу начать poll по этому URL
            var statusUrl = Url.Action(nameof(GetStatus), new { id }) ?? $"/api/submissions/{id}/status";

            return Accepted(new { id, statusUrl });
        }

        // 2) Быстрый статус из Redis
        [HttpGet("{id:guid}/status")]
        public async Task<IActionResult> GetStatus([FromRoute] Guid id)
        {
            var s = await _statusStore.GetAsync(id);
            return s is null ? NotFound() : Ok(s);
        }

        // 3) Финальный результат из БД (stdout и т.п.)
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> GetResult([FromRoute] Guid id, CancellationToken ct)
        {
            var submission = await _repo.GetAsync(id, ct);
            if (submission is null) return NotFound();

            return Ok(new
            {
                submission.Id,
                submission.Name,
                submission.Code,
                submission.Input,
                submission.Output // дальше можно добавить ExitCode, Error и т.д.
            });
        }
    }
}