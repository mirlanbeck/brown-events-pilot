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

    // BEVN-101: projection instead of lazy-loading proxies, see ResponseProjections.
    public async Task<List<Conference>> GetAllAsync()
    {
        return await _context.Conferences
            .OrderBy(c => c.Id)
            .Select(ResponseProjections.ForConference)
            .AsSplitQuery()
            .ToListAsync();
    }

    // BEVN-101: projection instead of lazy-loading proxies, see ResponseProjections.
    public async Task<Conference?> GetByIdAsync(int id)
    {
        return await _context.Conferences
            .Where(c => c.Id == id)
            .Select(ResponseProjections.ForConference)
            .AsSplitQuery()
            .FirstOrDefaultAsync();
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

        // BEVN-101: `existing` is a lazy-loading proxy; serializing it would load the whole graph (N+1).
        // Return the saved record the same way GetByIdAsync does.
        return await GetByIdAsync(id);
    }

    // BEVN-101 root cause and fix: see ResponseProjections. The sessions endpoint used to run one query per
    // navigation property read during serialization (22 for 2 sessions, 121+ for 100); now it is one query.
    public async Task<List<Session>> GetSessionsAsync(int conferenceId)
    {
        return await _context.Sessions
            .Where(s => s.ConferenceId == conferenceId)
            .OrderBy(s => s.Id)
            .Select(ResponseProjections.ForSession)
            .ToListAsync();
    }

    public async Task<Session> AddSessionAsync(int conferenceId, Session session)
    {
        session.ConferenceId = conferenceId;
        _context.Sessions.Add(session);
        await _context.SaveChangesAsync();

        // BEVN-101: after SaveChanges the shared context links the new session to related entities it already
        // tracks (lazy-loading proxies), and serializing them would load the whole graph (N+1).
        // Return a detached copy of the saved values instead.
        return new Session
        {
            Id = session.Id,
            Title = session.Title,
            Description = session.Description,
            StartTime = session.StartTime,
            EndTime = session.EndTime,
            Capacity = session.Capacity,
            ConferenceId = session.ConferenceId,
            SpeakerId = session.SpeakerId,
            RoomId = session.RoomId
        };
    }

    // BEVN-101: projection instead of lazy-loading proxies, see ResponseProjections.
    public async Task<List<Registration>> GetRegistrationsAsync(int conferenceId)
    {
        return await _context.Registrations
            .Where(r => r.ConferenceId == conferenceId)
            .OrderBy(r => r.Id)
            .Select(ResponseProjections.ForRegistration)
            .ToListAsync();
    }
}
