using BrownEvents.Api.Models;

namespace BrownEvents.Api.Swagger;

// Documentation-only types: they describe the `{ "data": ... }` envelope that ConferencesController builds
// with anonymous objects. They are referenced from [ProducesResponseType] and never instantiated by the API.

/// <summary>Envelope returned by <c>GET /api/conferences/{id}/sessions</c>.</summary>
public class SessionListResponse
{
    /// <summary>Sessions of the conference; empty if the conference has none or does not exist.</summary>
    public List<Session> Data { get; set; } = new();
}

/// <summary>Envelope returned by <c>POST /api/conferences/{id}/sessions</c>.</summary>
public class SessionResponse
{
    /// <summary>The created session, including its new <c>id</c>.</summary>
    public Session Data { get; set; } = null!;
}
