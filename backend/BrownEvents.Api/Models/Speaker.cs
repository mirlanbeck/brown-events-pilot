namespace BrownEvents.Api.Models;

public class Speaker
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string? Bio { get; set; }
    public string? Email { get; set; }

    public virtual ICollection<Session> Sessions { get; set; } = new List<Session>();
}
