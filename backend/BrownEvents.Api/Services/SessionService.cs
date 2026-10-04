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

    // BEVN-101: projection instead of lazy-loading proxies, see ResponseProjections.
    public async Task<Session?> GetByIdAsync(int id)
    {
        return await _context.Sessions
            .Where(s => s.Id == id)
            .Select(ResponseProjections.ForSession)
            .FirstOrDefaultAsync();
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

        // BEVN-101: `existing` is a lazy-loading proxy; serializing it would load the whole graph (N+1).
        // Return the saved record the same way GetByIdAsync does.
        return await GetByIdAsync(id);
    }
}
