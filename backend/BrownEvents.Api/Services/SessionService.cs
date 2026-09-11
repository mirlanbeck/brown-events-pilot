using BrownEvents.Api.Data;
using BrownEvents.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace BrownEvents.Api.Services;

public class SessionService : ISessionService
{
    private readonly AppDbContext _context;

    public SessionService(AppDbContext context)
    {
        _context = context;
    }

    public Task<Session?> GetByIdAsync(int id)
    {
        var session = _context.Sessions.FindAsync(id).Result;
        return Task.FromResult(session);
    }

    public async Task<Session?> UpdateAsync(int id, Session updated)
    {
        var existing = await _context.Sessions.FindAsync(id);
        if (existing is null) return null;

        existing.Title = updated.Title;
        existing.Description = updated.Description;
        existing.StartTime = updated.StartTime;
        existing.EndTime = updated.EndTime;
        existing.Capacity = updated.Capacity;
        existing.SpeakerId = updated.SpeakerId;
        existing.RoomId = updated.RoomId;

        await _context.SaveChangesAsync();
        return existing;
    }
}
