namespace BrownEvents.Api.Models;

public class Registration
{
    public int Id { get; set; }
    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow;
    public string Status { get; set; } = "CONFIRMED";

    public int ConferenceId { get; set; }
    public int AttendeeId { get; set; }

    public virtual Conference Conference { get; set; } = null!;
    public virtual Attendee Attendee { get; set; } = null!;
}
