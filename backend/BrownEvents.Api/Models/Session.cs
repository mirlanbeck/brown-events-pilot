namespace BrownEvents.Api.Models;

public class Session
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public int Capacity { get; set; }

    public int ConferenceId { get; set; }
    public int? SpeakerId { get; set; }
    public int? RoomId { get; set; }

    public virtual Conference Conference { get; set; } = null!;
    public virtual Speaker? Speaker { get; set; }
    public virtual Room? Room { get; set; }
}
