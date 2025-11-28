using AlgoPlatform.Application.Abstractions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace AlgoPlatform.Controllers
{
    [ApiController]
    [Route("api/executions")]
    public sealed class ExecutionsController : ControllerBase
    {
        private readonly ISubmissionQueuePublisher _publisher;

        public ExecutionsController(ISubmissionQueuePublisher publisher) => _publisher = publisher;

        [HttpPost("{id:guid}")]
        public async Task<IActionResult> Enqueue([FromRoute] Guid id, CancellationToken ct)
        {
            await _publisher.PublishAsync(id, ct);
            return Accepted(new { id, queued = true });
        }
    }
}
