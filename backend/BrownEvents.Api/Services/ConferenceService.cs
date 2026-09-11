using BrownEvents.Api.Data;
using BrownEvents.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace BrownEvents.Api.Services;

public class ConferenceService : IConferenceService
{
    private readonly AppDbContext _context;

    public ConferenceService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<List<Conference>> GetAllAsync()
    {
        return await _context.Conferences.ToListAsync();
    }

    public Task<Conference?> GetByIdAsync(int id)
    {
        var conference = _context.Conferences.FindAsync(id).Result;
        return Task.FromResult(conference);
    }

    public async Task<Conference> CreateAsync(Conference conference)
    {
        _context.Conferences.Add(conference);
        await _context.SaveChangesAsync();
        return conference;
    }

    public async Task<Conference?> UpdateAsync(int id, Conference updated)
    {
        var existing = _context.Conferences.FindAsync(id).Result;
        if (existing is null) return null;

        existing.Title = updated.Title;
        existing.Description = updated.Description;
        existing.Location = updated.Location;
        existing.Venue = updated.Venue;
        existing.StartDate = updated.StartDate;
        existing.EndDate = updated.EndDate;
        existing.Status = updated.Status.ToUpper();
        existing.MaxAttendees = updated.MaxAttendees;
        existing.OrganizerName = updated.OrganizerName;
        existing.Website = updated.Website;

        await _context.SaveChangesAsync();
        return existing;
    }

    public async Task<List<Session>> GetSessionsAsync(int conferenceId)
    {
        return await _context.Sessions
            .Where(s => s.ConferenceId == conferenceId)
            .ToListAsync();
    }

    public async Task<Session> AddSessionAsync(int conferenceId, Session session)
    {
        session.ConferenceId = conferenceId;
        _context.Sessions.Add(session);
        await _context.SaveChangesAsync();
        return session;
    }

    public async Task<List<Registration>> GetRegistrationsAsync(int conferenceId)
    {
        return await _context.Registrations
            .Where(r => r.ConferenceId == conferenceId)
            .ToListAsync();
    }
}
