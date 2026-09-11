namespace BrownEvents.Api.Models;

public class Conference
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Location { get; set; }
    public string? Venue { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public string Status { get; set; } = "UPCOMING";
    public int? MaxAttendees { get; set; }
    public string? OrganizerName { get; set; }
    public string? Website { get; set; }

    public virtual ICollection<Session> Sessions { get; set; } = new List<Session>();
    public virtual ICollection<Registration> Registrations { get; set; } = new List<Registration>();
}
