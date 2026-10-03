namespace BrownEvents.Api.Models;

/// <summary>A talk or workshop within a conference.</summary>
public class Session
{
    /// <summary>Assigned by the server. Do not send when creating.</summary>
    /// <example>4</example>
    public int Id { get; set; }

    /// <summary>Session title. Not validated; stored as an empty string if omitted.</summary>
    /// <example>Kubernetes for .NET Developers</example>
    public string Title { get; set; } = string.Empty;

    /// <summary>Free-text description.</summary>
    public string? Description { get; set; }

    /// <summary>Start (date format: see "Dates" in the API description).</summary>
    /// <example>2025-03-05T10:00:00</example>
    public DateTime StartTime { get; set; }

    /// <summary>End (date format: see "Dates" in the API description). Not checked against <c>startTime</c>.</summary>
    /// <example>2025-03-05T11:00:00</example>
    public DateTime EndTime { get; set; }

    /// <summary>Number of seats. Not checked against the room's capacity.</summary>
    /// <example>200</example>
    public int Capacity { get; set; }

    /// <summary>Owning conference. Set from the URL on create and never changed by update; a value in a request body is ignored.</summary>
    /// <example>2</example>
    public int ConferenceId { get; set; }

    /// <summary>Optional speaker id. Must reference an existing speaker, otherwise the request fails with 500.</summary>
    /// <example>3</example>
    public int? SpeakerId { get; set; }

    /// <summary>Optional room id. Must reference an existing room, otherwise the request fails with 500. There is no rooms endpoint; seeded rooms have ids 1–4.</summary>
    /// <example>1</example>
    public int? RoomId { get; set; }

    /// <summary>Response only (lazy-loaded): the owning conference. Omit in requests.</summary>
    public virtual Conference Conference { get; set; } = null!;

    /// <summary>Response only (lazy-loaded): the speaker, or null. Omit in requests.</summary>
    public virtual Speaker? Speaker { get; set; }

    /// <summary>Response only (lazy-loaded): the room, or null. Omit in requests.</summary>
    public virtual Room? Room { get; set; }
}
