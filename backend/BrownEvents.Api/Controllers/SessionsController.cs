using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using BrownEvents.Api.Swagger.Examples;
using Microsoft.AspNetCore.Mvc;
using Swashbuckle.AspNetCore.Filters;

namespace BrownEvents.Api.Controllers;

/// <summary>Individual sessions. To list or create sessions, use the conference endpoints.</summary>
[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly ISessionService _service;

    public SessionsController(ISessionService service)
    {
        _service = service;
    }

    /// <summary>Get a session by id.</summary>
    /// <remarks>
    /// The session includes `speaker`, `room` and `conference` (with that conference's other sessions and registrations).
    /// </remarks>
    /// <param name="id">Session id. A non-numeric value is treated as `0` and gives `404`.</param>
    /// <response code="200">The session.</response>
    /// <response code="404">No session with this id. Empty body.</response>
    /// <response code="500">Server error, e.g. the database is unavailable. Empty body.</response>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(Session), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(SessionExample))]
    public async Task<IActionResult> GetById(int id)
    {
        var session = await _service.GetByIdAsync(id);
        if (session is null) return NotFound();
        return Ok(session);
    }

    /// <summary>Replace a session's details.</summary>
    /// <remarks>
    /// Full replacement of `title`, `description`, `startTime`, `endTime`, `capacity`, `speakerId`, `roomId`.
    /// **Always send all of them**: an omitted field is overwritten with `title` → `""`, `description` → `null`,
    /// times → `0001-01-01T00:00:00`, `capacity` → `0`, `speakerId`/`roomId` → `null`.
    /// `id` and `conferenceId` in the body are ignored — a session cannot be moved to another conference.
    ///
    /// Nothing is validated: times, `capacity` vs. room size and overlapping sessions in the same room are not checked.
    /// </remarks>
    /// <param name="id">Session id. A non-numeric value is treated as `0` and gives `404`.</param>
    /// <param name="session">New values for the session.</param>
    /// <response code="200">The updated session.</response>
    /// <response code="404">No session with this id. Empty body.</response>
    /// <response code="415">`Content-Type` is missing or not JSON (also for a request sent without a body). Empty body.</response>
    /// <response code="500">
    /// Non-existent `speakerId` or `roomId`, empty or malformed JSON body, or database error. Empty body.
    /// After an invalid reference, all following write requests also fail with `500` until the API is restarted.
    /// </response>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(Session), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerRequestExample(typeof(Session), typeof(UpdateSessionRequestExample))]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(UpdatedSessionExample))]
    public async Task<IActionResult> Update(int id, [FromBody] Session session)
    {
        var updated = await _service.UpdateAsync(id, session);
        if (updated is null) return NotFound();
        return Ok(updated);
    }
}
