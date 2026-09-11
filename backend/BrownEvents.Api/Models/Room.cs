namespace BrownEvents.Api.Models;

public class Room
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Capacity { get; set; }
    public string? Location { get; set; }

    public virtual ICollection<Session> Sessions { get; set; } = new List<Session>();
}
