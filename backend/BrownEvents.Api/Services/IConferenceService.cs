using BrownEvents.Api.Models;

namespace BrownEvents.Api.Services;

public interface IConferenceService
{
    Task<List<Conference>> GetAllAsync();
    Task<Conference?> GetByIdAsync(int id);
    Task<Conference> CreateAsync(Conference conference);
    Task<Conference?> UpdateAsync(int id, Conference conference);
    Task<List<Session>> GetSessionsAsync(int conferenceId);
    Task<Session> AddSessionAsync(int conferenceId, Session session);
    Task<List<Registration>> GetRegistrationsAsync(int conferenceId);
}
