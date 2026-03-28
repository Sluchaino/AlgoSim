using AlgoPlatform.Application.Abstractions;
using AlgoPlatform.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace AlgoPlatform.Controllers
{
    [ApiController]
    [Route("api/metrics")]
    public sealed class MetricsController : ControllerBase
    {
        private readonly ISubmissionRepository _submissions;

        public MetricsController(ISubmissionRepository submissions)
        {
            _submissions = submissions;
        }

        [HttpGet("submissions")]
        public async Task<IActionResult> GetSubmissionMetrics(CancellationToken ct)
        {
            var m = await _submissions.GetMetricsAsync(ct);
            return Ok(new SubmissionMetricsResponse(
                m.Total,
                m.Queued,
                m.Running,
                m.Completed,
                m.Failed));
        }
    }
}
