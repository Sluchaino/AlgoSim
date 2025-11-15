using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Cryptography;

namespace AlgoPlatform.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class DescriptionAlgorithmsController : ControllerBase
    {
        private readonly IMediator _mediator;
        public DescriptionAlgorithmsController(IMediator mediator) 
        {
            _mediator = mediator;
        }
        [HttpGet]
        public ActionResult<IEnumerable<string>> GetAllAlgorithmsNames()
        {
            List<string> names = _mediator.Send(new );
            return Ok(names);
        }
    }
}
