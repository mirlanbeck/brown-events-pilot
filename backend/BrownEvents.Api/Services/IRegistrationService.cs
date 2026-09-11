using BrownEvents.Api.Models;

namespace BrownEvents.Api.Services;

public interface IRegistrationService
{
    Task<Registration> RegisterAttendeeAsync(int conferenceId, Attendee attendeeData);
}
