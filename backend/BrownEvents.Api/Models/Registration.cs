namespace BrownEvents.Api.Models;

/// <summary>An attendee's registration for a conference. Created only by the register endpoint.</summary>
public class Registration
{
    /// <summary>Registration id.</summary>
    /// <example>1</example>
    public int Id { get; set; }

    /// <summary>When the registration was made, in UTC: with a trailing Z right after registering, without it once re-read from the database.</summary>
    /// <example>2025-02-10T09:15:42</example>
    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;

    /// <summary>Always CONFIRMED: the API has no way to change it.</summary>
    /// <example>CONFIRMED</example>
    public string Status { get; set; } = "CONFIRMED";

    /// <summary>The conference registered for.</summary>
    /// <example>2</example>
    public int ConferenceId { get; set; }

    /// <summary>The registered attendee.</summary>
    /// <example>1</example>
    public int AttendeeId { get; set; }

    /// <summary>Lazy-loaded: the conference, or null when it is the parent object being serialized or was not loaded.</summary>
    public virtual Conference Conference { get; set; } = null!;

    /// <summary>Lazy-loaded: the attendee, including e-mail.</summary>
    public virtual Attendee Attendee { get; set; } = null!;
}
