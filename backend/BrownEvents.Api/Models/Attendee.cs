namespace BrownEvents.Api.Models;

public class Attendee
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;

    public virtual ICollection<Registration> Registrations { get; set; } = new List<Registration>();
}
