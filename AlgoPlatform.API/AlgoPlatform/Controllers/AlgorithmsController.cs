using AlgoPlatform.Application.DTO;
using AlgoPlatform.Application.Interfaces;
using AlgoPlatform.Application.Services;
using AlgoPlatform.Domain.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Cryptography;

namespace AlgoPlatform.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AlgorithmsController : ControllerBase
    {
        private readonly IAlgorithmsService _algorithmService;
        public AlgorithmsController(IAlgorithmsService algorithmService) 
        {
            _algorithmService = algorithmService;
        }
        [HttpGet]
        public async Task<ActionResult<IReadOnlyList<string>>> GetAllAlgorithmsName()
        {
            IReadOnlyList<string?> names = await _algorithmService.GetAllAlgorithmsNamesAsync();
            return Ok(names);
        }
        [HttpGet("{id}")]
        public async Task<ActionResult<Algorithm?>> GetAlgorithmsById(int id)
        {
            Algorithm? names = await _algorithmService.GetAlgorithmByIdAsync(id);
            return Ok(names);
        }
        [HttpPost]
        public async Task<ActionResult> SubmitCode([FromBody] SubmitCodeDTO dto)
        {
            //var submissionId = await _mediator.Send(new SubmitCodeCommand(dto));
            //return Accepted(new { submissionId });
            return Ok();
        }
    }
}
