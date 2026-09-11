using BrownEvents.Api.Models;

namespace BrownEvents.Api.Services;

public interface ISessionService
{
    Task<Session?> GetByIdAsync(int id);
    Task<Session?> UpdateAsync(int id, Session session);
}
