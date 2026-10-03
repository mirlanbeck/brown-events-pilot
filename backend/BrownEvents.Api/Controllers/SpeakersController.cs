using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using BrownEvents.Api.Swagger.Examples;
using Microsoft.AspNetCore.Mvc;
using Swashbuckle.AspNetCore.Filters;

namespace BrownEvents.Api.Controllers;

/// <summary>Speakers. There is no endpoint to get, update or delete a single speaker.</summary>
[Route("api/speakers")]
public class SpeakersController : ControllerBase
{
    private readonly ISpeakerService _service;

    public SpeakersController(ISpeakerService service)
    {
        _service = service;
    }

    /// <summary>List all speakers.</summary>
    /// <remarks>
    /// Each speaker includes their `sessions` (with `room` and `conference`).
    /// </remarks>
    /// <response code="200">Array of speakers; empty if there are none.</response>
    /// <response code="500">Server error, e.g. the database is unavailable. Empty body.</response>
    [HttpGet]
    [ProducesResponseType(typeof(List<Speaker>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(SpeakerListExample))]
    public async Task<IActionResult> GetAll()
    {
        var speakers = await _service.GetAllAsync();
        return Ok(speakers);
    }

    /// <summary>Create a speaker.</summary>
    /// <remarks>
    /// Returns `200 OK` (not `201`) with the created speaker and its new `id`.
    /// Do not send `id`: the server assigns it. Nothing is validated; `email` is optional and not checked for uniqueness.
    /// </remarks>
    /// <param name="speaker">The speaker to create.</param>
    /// <response code="200">The created speaker.</response>
    /// <response code="415">`Content-Type` is missing or not JSON (also for a request sent without a body). Empty body.</response>
    /// <response code="500">Empty or malformed JSON body, conflicting `id`, or database error. Empty body.</response>
    [HttpPost]
    [ProducesResponseType(typeof(Speaker), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerRequestExample(typeof(Speaker), typeof(CreateSpeakerRequestExample))]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(CreatedSpeakerExample))]
    public async Task<IActionResult> Create([FromBody] Speaker speaker)
    {
        var created = await _service.CreateAsync(speaker);
        return Ok(created);
    }
}
