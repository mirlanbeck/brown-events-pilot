namespace BrownEvents.Api.Models;

/// <summary>A conference.</summary>
public class Conference
{
    /// <summary>Assigned by the server. Do not send when creating.</summary>
    /// <example>2</example>
    public int Id { get; set; }

    /// <summary>Conference name. Not validated; stored as an empty string if omitted.</summary>
    /// <example>CloudOps Days</example>
    public string Title { get; set; } = string.Empty;

    /// <summary>Free-text description.</summary>
    public string? Description { get; set; }

    /// <summary>City and country.</summary>
    /// <example>Amsterdam, Netherlands</example>
    public string? Location { get; set; }

    /// <summary>Venue name.</summary>
    /// <example>Beurs van Berlage</example>
    public string? Venue { get; set; }

    /// <summary>First day (date format: see "Dates" in the API description).</summary>
    /// <example>2025-03-05T00:00:00</example>
    public DateTime StartDate { get; set; }

    /// <summary>Last day (date format: see "Dates" in the API description). Not checked against <c>startDate</c>.</summary>
    /// <example>2025-03-06T00:00:00</example>
    public DateTime EndDate { get; set; }

    /// <summary>
    /// Free-form string; the frontend recognises UPCOMING, ACTIVE, COMPLETED, CANCELLED. Defaults to UPCOMING.
    /// Stored as sent on create; upper-cased on update, where it must not be null.
    /// </summary>
    /// <example>UPCOMING</example>
    public string Status { get; set; } = "UPCOMING";

    /// <summary>Informational only: registrations are not limited by it.</summary>
    /// <example>400</example>
    public int? MaxAttendees { get; set; }

    /// <summary>Organizer name.</summary>
    /// <example>Infra Guild</example>
    public string? OrganizerName { get; set; }

    /// <summary>Conference website URL. Not validated.</summary>
    /// <example>https://cloudopsdays.example.com</example>
    public string? Website { get; set; }

    /// <summary>Response only (lazy-loaded): sessions of this conference. Omit in requests.</summary>
    public virtual ICollection<Session> Sessions { get; set; } = new List<Session>();

    /// <summary>Response only (lazy-loaded): registrations of this conference, with attendee details. Omit in requests.</summary>
    public virtual ICollection<Registration> Registrations { get; set; } = new List<Registration>();
}
