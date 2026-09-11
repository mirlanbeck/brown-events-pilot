using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace BrownEvents.Api.Controllers;

[Route("api/sessions")]
public class SessionsController : ControllerBase
{
    private readonly ISessionService _service;

    public SessionsController(ISessionService service)
    {
        _service = service;
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var session = await _service.GetByIdAsync(id);
        if (session is null) return NotFound();
        return Ok(session);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] Session session)
    {
        var updated = await _service.UpdateAsync(id, session);
        if (updated is null) return NotFound();
        return Ok(updated);
    }
}
