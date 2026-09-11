using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace BrownEvents.Api.Controllers;

[Route("api/speakers")]
public class SpeakersController : ControllerBase
{
    private readonly ISpeakerService _service;

    public SpeakersController(ISpeakerService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var speakers = await _service.GetAllAsync();
        return Ok(speakers);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Speaker speaker)
    {
        var created = await _service.CreateAsync(speaker);
        return Ok(created);
    }
}
