using BrownEvents.Api.Data;
using BrownEvents.Api.Models;

namespace BrownEvents.Api.Services;

public class RegistrationService : IRegistrationService
{
    private readonly AppDbContext _context;

    public RegistrationService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<Registration> RegisterAttendeeAsync(int conferenceId, Attendee attendeeData)
    {
        //

        var existing = _context.Attendees.FirstOrDefault(a => a.Email == attendeeData.Email);

        Attendee attendee;
        if (existing is null)
        {
            _context.Attendees.Add(attendeeData);
            await _context.SaveChangesAsync();
            attendee = attendeeData;
        }
        else
        {
            attendee = existing;
        }

        var registration = new Registration
        {
            ConferenceId = conferenceId,
            AttendeeId   = attendee.Id,
            RegisteredAt = DateTime.UtcNow,
            Status       = "CONFIRMED"
        };

        _context.Registrations.Add(registration);
        await _context.SaveChangesAsync();

        return registration;
    }
}
