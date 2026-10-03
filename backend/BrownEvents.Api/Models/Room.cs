namespace BrownEvents.Api.Models;

/// <summary>A room at the venue. Read-only for clients: it appears only nested in sessions; there is no rooms endpoint.</summary>
public class Room
{
    /// <summary>Room id; use it as <c>roomId</c> of a session.</summary>
    /// <example>1</example>
    public int Id { get; set; }

    /// <summary>Room name.</summary>
    /// <example>Hall A</example>
    public string Name { get; set; } = string.Empty;

    /// <summary>Number of seats.</summary>
    /// <example>300</example>
    public int Capacity { get; set; }

    /// <summary>Where the room is in the building.</summary>
    /// <example>Ground Floor</example>
    public string? Location { get; set; }

    /// <summary>Response only (lazy-loaded): sessions held in this room.</summary>
    public virtual ICollection<Session> Sessions { get; set; } = new List<Session>();
}
