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

        // BEVN-101: after SaveChanges the shared context links the registration to the tracked attendee and, if
        // already loaded, the conference; when those are lazy-loading proxies, serializing them would load the whole
        // graph (N+1). Return a detached copy of the saved values with the attendee's own fields instead.
        return new Registration
        {
            Id = registration.Id,
            RegisteredAt = registration.RegisteredAt,
            Status = registration.Status,
            ConferenceId = registration.ConferenceId,
            AttendeeId = registration.AttendeeId,
            Attendee = new Attendee
            {
                Id = attendee.Id,
                FirstName = attendee.FirstName,
                LastName = attendee.LastName,
                Email = attendee.Email
            }
        };
    }
}
