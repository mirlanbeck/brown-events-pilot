namespace BrownEvents.Api.Models;

/// <summary>
/// A conference attendee. As the body of the register endpoint only <c>firstName</c>, <c>lastName</c> and <c>email</c> are read.
/// </summary>
public class Attendee
{
    /// <summary>Assigned by the server. Do not send.</summary>
    /// <example>1</example>
    public int Id { get; set; }

    /// <summary>First name. Not validated. Ignored if an attendee with this e-mail already exists.</summary>
    /// <example>Maria</example>
    public string FirstName { get; set; } = string.Empty;

    /// <summary>Last name. Not validated. Ignored if an attendee with this e-mail already exists.</summary>
    /// <example>Kowalska</example>
    public string LastName { get; set; } = string.Empty;

    /// <summary>Identifies the attendee (exact, case-sensitive match). Not validated; may be empty.</summary>
    /// <example>maria.kowalska@example.com</example>
    public string Email { get; set; } = string.Empty;

    /// <summary>Response only (lazy-loaded): this attendee's registrations. Omit in requests.</summary>
    public virtual ICollection<Registration> Registrations { get; set; } = new List<Registration>();
}
