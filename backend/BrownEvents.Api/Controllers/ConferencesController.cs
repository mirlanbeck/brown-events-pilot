using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace BrownEvents.Api.Controllers;

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

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var conferences = await _service.GetAllAsync();
        return Ok(conferences);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var conference = await _service.GetByIdAsync(id);
        if (conference is null) return NotFound();
        return Ok(conference);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Conference conference)
    {
        var created = await _service.CreateAsync(conference);
        return Ok(created);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] Conference conference)
    {
        var updated = await _service.UpdateAsync(id, conference);
        if (updated is null) return NotFound();
        return Ok(updated);
    }

    [HttpGet("{id}/sessions")]
    public async Task<IActionResult> GetSessions(int id)
    {
        var sessions = await _service.GetSessionsAsync(id);
        return Ok(new { data = sessions });
    }

    [HttpPost("{id}/sessions")]
    public async Task<IActionResult> AddSession(int id, [FromBody] Session session)
    {
        var created = await _service.AddSessionAsync(id, session);
        return Ok(new { data = created });
    }

    [HttpGet("{id}/registrations")]
    public async Task<IActionResult> GetRegistrations(int id)
    {
        var registrations = await _service.GetRegistrationsAsync(id);
        return Ok(registrations);
    }

    [HttpPost("{id}/register")]
    public async Task<IActionResult> Register(int id, [FromBody] Attendee attendee)
    {
        var registration = await _registrationService.RegisterAttendeeAsync(id, attendee);
        return Ok(registration);
    }
}
