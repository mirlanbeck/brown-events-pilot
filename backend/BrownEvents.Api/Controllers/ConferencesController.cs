using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using BrownEvents.Api.Swagger;
using BrownEvents.Api.Swagger.Examples;
using Microsoft.AspNetCore.Mvc;
using Swashbuckle.AspNetCore.Filters;

namespace BrownEvents.Api.Controllers;

/// <summary>Conferences, their sessions and attendee registrations.</summary>
[Route("api/conferences")]
public class ConferencesController : ControllerBase
{
    private readonly IConferenceService _service;
    private readonly IRegistrationService _registrationService;

    public ConferencesController(IConferenceService service, IRegistrationService registrationService)
    {
        _service = service;
        _registrationService = registrationService;
    }

    /// <summary>List all conferences.</summary>
    /// <remarks>
    /// Returns every conference, without paging, filtering or sorting guarantees.
    /// Each conference also contains its `sessions` and `registrations` (with `attendee`, including e-mail),
    /// because related data is loaded while the response is serialized.
    /// </remarks>
    /// <response code="200">Array of conferences; empty if there are none.</response>
    /// <response code="500">Server error, e.g. the database is unavailable. Empty body.</response>
    [HttpGet]
    [ProducesResponseType(typeof(List<Conference>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(ConferenceListExample))]
    public async Task<IActionResult> GetAll()
    {
        var conferences = await _service.GetAllAsync();
        return Ok(conferences);
    }

    /// <summary>Get a conference by id.</summary>
    /// <remarks>
    /// The conference includes its `sessions` and `registrations` (with `attendee`, including e-mail).
    /// </remarks>
    /// <param name="id">Conference id. A non-numeric value is treated as `0` and gives `404`.</param>
    /// <response code="200">The conference.</response>
    /// <response code="404">No conference with this id. Empty body.</response>
    /// <response code="500">Server error, e.g. the database is unavailable. Empty body.</response>
    [HttpGet("{id}")]
    [ProducesResponseType(typeof(Conference), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(ConferenceExample))]
    public async Task<IActionResult> GetById(int id)
    {
        var conference = await _service.GetByIdAsync(id);
        if (conference is null) return NotFound();
        return Ok(conference);
    }

    /// <summary>Create a conference.</summary>
    /// <remarks>
    /// Returns `200 OK` (not `201`) with the created conference and its new `id`.
    ///
    /// - Do not send `id`: the server assigns it. An explicit `id` that already exists causes `500`.
    /// - `status` is stored exactly as sent (it is **not** upper-cased, unlike in `PUT`); defaults to `UPCOMING` if omitted.
    ///   The frontend recognises `UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED`; the server accepts any string.
    /// - Nothing is validated: a missing `title` is stored as an empty string, `endDate` may precede `startDate`.
    /// </remarks>
    /// <param name="conference">The conference to create.</param>
    /// <response code="200">The created conference.</response>
    /// <response code="415">`Content-Type` is missing or not JSON (also for a request sent without a body). Empty body.</response>
    /// <response code="500">Empty or malformed JSON body, conflicting `id`, or database error. Empty body.</response>
    [HttpPost]
    [ProducesResponseType(typeof(Conference), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerRequestExample(typeof(Conference), typeof(CreateConferenceRequestExample))]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(CreatedConferenceExample))]
    public async Task<IActionResult> Create([FromBody] Conference conference)
    {
        var created = await _service.CreateAsync(conference);
        return Ok(created);
    }

    /// <summary>Replace a conference's details.</summary>
    /// <remarks>
    /// Full replacement of `title`, `description`, `location`, `venue`, `startDate`, `endDate`, `status`,
    /// `maxAttendees`, `organizerName`, `website`. **Always send all of them**: an omitted field is overwritten with
    /// `title` → `""`, other strings → `null`, `maxAttendees` → `null`, dates → `0001-01-01T00:00:00`, `status` → `UPCOMING`.
    /// `id`, `sessions` and `registrations` in the body are ignored.
    ///
    /// - `status` is upper-cased (`active` → `ACTIVE`). If omitted it silently becomes `UPCOMING`;
    ///   an explicit `"status": null` causes `500`. That failure happens after some fields were already copied,
    ///   so they may show up in later `GET` responses.
    /// - Nothing else is validated.
    /// </remarks>
    /// <param name="id">Conference id. A non-numeric value is treated as `0` and gives `404`.</param>
    /// <param name="conference">New values for the conference.</param>
    /// <response code="200">The updated conference.</response>
    /// <response code="404">No conference with this id. Empty body.</response>
    /// <response code="415">`Content-Type` is missing or not JSON (also for a request sent without a body). Empty body.</response>
    /// <response code="500">`"status": null`, empty or malformed JSON body, or database error. Empty body.</response>
    [HttpPut("{id}")]
    [ProducesResponseType(typeof(Conference), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerRequestExample(typeof(Conference), typeof(UpdateConferenceRequestExample))]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(UpdatedConferenceExample))]
    public async Task<IActionResult> Update(int id, [FromBody] Conference conference)
    {
        var updated = await _service.UpdateAsync(id, conference);
        if (updated is null) return NotFound();
        return Ok(updated);
    }

    /// <summary>List the sessions of a conference.</summary>
    /// <remarks>
    /// The array is wrapped: `{ "data": [ ... ] }` — the only `GET` that does this.
    /// Each session includes `speaker`, `room` and `conference` (with that conference's other sessions and registrations).
    /// A non-existent conference gives `200` with `{ "data": [] }`, not `404`.
    /// </remarks>
    /// <param name="id">Conference id.</param>
    /// <response code="200">Sessions of the conference wrapped in `data`; empty if the conference has none or does not exist.</response>
    /// <response code="500">Server error, e.g. the database is unavailable. Empty body.</response>
    [HttpGet("{id}/sessions")]
    [ProducesResponseType(typeof(SessionListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(SessionListResponseExample))]
    public async Task<IActionResult> GetSessions(int id)
    {
        var sessions = await _service.GetSessionsAsync(id);
        return Ok(new { data = sessions });
    }

    /// <summary>Add a session to a conference.</summary>
    /// <remarks>
    /// Returns `200 OK` (not `201`) with the created session wrapped: `{ "data": { ... } }`.
    ///
    /// - `conferenceId` is taken from the URL; a value in the body is ignored. Do not send `id`.
    /// - `speakerId` and `roomId` are optional (`null`), but if given must exist.
    /// - Nothing is validated: times, `capacity` vs. room size and overlapping sessions are not checked.
    /// - In the response, `speaker`, `room` and `conference` are filled only if the server already had them loaded; otherwise `null`.
    /// </remarks>
    /// <param name="id">Conference id. Must exist, otherwise `500`.</param>
    /// <param name="session">The session to create.</param>
    /// <response code="200">The created session wrapped in `data`.</response>
    /// <response code="415">`Content-Type` is missing or not JSON (also for a request sent without a body). Empty body.</response>
    /// <response code="500">
    /// Non-existent conference, speaker or room; empty or malformed JSON body; or database error. Empty body.
    /// After an invalid reference, all following write requests also fail with `500` until the API is restarted.
    /// </response>
    [HttpPost("{id}/sessions")]
    [ProducesResponseType(typeof(SessionResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerRequestExample(typeof(Session), typeof(CreateSessionRequestExample))]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(SessionResponseExample))]
    public async Task<IActionResult> AddSession(int id, [FromBody] Session session)
    {
        var created = await _service.AddSessionAsync(id, session);
        return Ok(new { data = created });
    }

    /// <summary>List the registrations of a conference.</summary>
    /// <remarks>
    /// Each registration includes `attendee` (with e-mail) and `conference`.
    /// A non-existent conference gives `200` with `[]`, not `404`.
    /// </remarks>
    /// <param name="id">Conference id.</param>
    /// <response code="200">Registrations of the conference; empty if there are none or the conference does not exist.</response>
    /// <response code="500">Server error, e.g. the database is unavailable. Empty body.</response>
    [HttpGet("{id}/registrations")]
    [ProducesResponseType(typeof(List<Registration>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(RegistrationListExample))]
    public async Task<IActionResult> GetRegistrations(int id)
    {
        var registrations = await _service.GetRegistrationsAsync(id);
        return Ok(registrations);
    }

    /// <summary>Register an attendee for a conference.</summary>
    /// <remarks>
    /// Only `firstName`, `lastName` and `email` are read; any other fields (phone, company, ...) are silently dropped.
    /// Returns `200 OK` with the new registration (`status` is always `CONFIRMED`).
    ///
    /// - The attendee is looked up by exact, case-sensitive `email`. If one exists, it is reused and the names in the body are ignored;
    ///   otherwise a new attendee is created.
    /// - Not checked: duplicate registration (a second one is created), `maxAttendees`, conference `status`, empty fields.
    /// - No confirmation e-mail is sent.
    /// </remarks>
    /// <param name="id">Conference id. Must exist, otherwise `500`.</param>
    /// <param name="attendee">The attendee's details.</param>
    /// <response code="200">The created registration, with `attendee`.</response>
    /// <response code="415">`Content-Type` is missing or not JSON (also for a request sent without a body). Empty body.</response>
    /// <response code="500">
    /// Non-existent conference (a new attendee may already have been saved), empty or malformed JSON body, or database error. Empty body.
    /// After a non-existent conference, all following write requests also fail with `500` until the API is restarted.
    /// </response>
    [HttpPost("{id}/register")]
    [ProducesResponseType(typeof(Registration), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status415UnsupportedMediaType)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    [SwaggerRequestExample(typeof(Attendee), typeof(RegisterAttendeeRequestExample))]
    [SwaggerResponseExample(StatusCodes.Status200OK, typeof(RegistrationExample))]
    public async Task<IActionResult> Register(int id, [FromBody] Attendee attendee)
    {
        var registration = await _registrationService.RegisterAttendeeAsync(id, attendee);
        return Ok(registration);
    }
}
