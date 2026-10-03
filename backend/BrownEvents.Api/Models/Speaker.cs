namespace BrownEvents.Api.Models;

/// <summary>A conference speaker.</summary>
public class Speaker
{
    /// <summary>Assigned by the server. Do not send when creating.</summary>
    /// <example>3</example>
    public int Id { get; set; }

    /// <summary>First name. Not validated.</summary>
    /// <example>Chloe</example>
    public string FirstName { get; set; } = string.Empty;

    /// <summary>Last name. Not validated.</summary>
    /// <example>Tanaka</example>
    public string LastName { get; set; } = string.Empty;

    /// <summary>Short biography.</summary>
    /// <example>Staff SRE at Observio. Reliability evangelist.</example>
    public string? Bio { get; set; }

    /// <summary>Contact e-mail. Optional, not validated, not unique.</summary>
    /// <example>chloe.tanaka@example.com</example>
    public string? Email { get; set; }

    /// <summary>Response only (lazy-loaded): sessions given by this speaker. Omit in requests.</summary>
    public virtual ICollection<Session> Sessions { get; set; } = new List<Session>();
}
