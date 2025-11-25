
using AlgoPlatform.Application.Interfaces;
using Microsoft.AspNetCore.Mvc;
using AlgoPlatform.Application.Request;

namespace AlgoPlatform.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class SubmissionsController : ControllerBase
    {
        private readonly ISubmissionsService _submissions;

        public SubmissionsController(ISubmissionsService submissions)
            => _submissions = submissions;

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] SubmitCodeRequest req, CancellationToken ct)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var id = await _submissions.CreateAsync(req.Name, req.Code, req.Input, ct);

            // Можно вернуть ссылку на эндпоинт статуса; он может быть реализован позже.
            var location = $"/api/submissions/{id}/status";
            return Accepted(location, new { id });
        }
    }
}
