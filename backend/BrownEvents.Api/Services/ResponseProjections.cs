using System.Linq.Expressions;
using BrownEvents.Api.Models;

namespace BrownEvents.Api.Services;

// BEVN-101 root cause: services returned entities tracked by the shared context with lazy-loading proxies
// (UseLazyLoadingProxies in Program.cs). While writing the response, the JSON serializer read every navigation
// property, and each read ran its own synchronous SELECT (N+1): session -> conference -> its sessions -> speaker ->
// speaker's sessions -> room -> ... until the whole reachable database was loaded (22 queries for 2 sessions,
// 121+ for 100), and graphs deeper than 32 levels broke the response (200 OK followed by a truncated body or a 500).
// Fix: the read methods project into these new, untracked, non-proxy objects that hold the record and its direct
// relations (one level, each with its own fields only), loaded by one query with JOINs (split into one query per
// collection where a record has two). Nothing is left for the serializer to load, so the number of queries no
// longer depends on the number of rows. Lists and nested collections are ordered by Id: the old queries had no ORDER BY
// and returned rows in storage order, which a JOIN no longer preserves.
internal static class ResponseProjections
{
    public static readonly Expression<Func<Session, Session>> ForSession = s => new Session
    {
        Id = s.Id,
        Title = s.Title,
        Description = s.Description,
        StartTime = s.StartTime,
        EndTime = s.EndTime,
        Capacity = s.Capacity,
        ConferenceId = s.ConferenceId,
        SpeakerId = s.SpeakerId,
        RoomId = s.RoomId,
        Conference = new Conference
        {
            Id = s.Conference.Id,
            Title = s.Conference.Title,
            Description = s.Conference.Description,
            Location = s.Conference.Location,
            Venue = s.Conference.Venue,
            StartDate = s.Conference.StartDate,
            EndDate = s.Conference.EndDate,
            Status = s.Conference.Status,
            MaxAttendees = s.Conference.MaxAttendees,
            OrganizerName = s.Conference.OrganizerName,
            Website = s.Conference.Website
        },
        Speaker = s.Speaker == null ? null : new Speaker
        {
            Id = s.Speaker.Id,
            FirstName = s.Speaker.FirstName,
            LastName = s.Speaker.LastName,
            Bio = s.Speaker.Bio,
            Email = s.Speaker.Email
        },
        Room = s.Room == null ? null : new Room
        {
            Id = s.Room.Id,
            Name = s.Room.Name,
            Capacity = s.Room.Capacity,
            Location = s.Room.Location
        }
    };

    public static readonly Expression<Func<Conference, Conference>> ForConference = c => new Conference
    {
        Id = c.Id,
        Title = c.Title,
        Description = c.Description,
        Location = c.Location,
        Venue = c.Venue,
        StartDate = c.StartDate,
        EndDate = c.EndDate,
        Status = c.Status,
        MaxAttendees = c.MaxAttendees,
        OrganizerName = c.OrganizerName,
        Website = c.Website,
        Sessions = c.Sessions.OrderBy(s => s.Id).Select(s => new Session
        {
            Id = s.Id,
            Title = s.Title,
            Description = s.Description,
            StartTime = s.StartTime,
            EndTime = s.EndTime,
            Capacity = s.Capacity,
            ConferenceId = s.ConferenceId,
            SpeakerId = s.SpeakerId,
            RoomId = s.RoomId
        }).ToList(),
        Registrations = c.Registrations.OrderBy(r => r.Id).Select(r => new Registration
        {
            Id = r.Id,
            RegisteredAt = r.RegisteredAt,
            Status = r.Status,
            ConferenceId = r.ConferenceId,
            AttendeeId = r.AttendeeId
        }).ToList()
    };

    public static readonly Expression<Func<Registration, Registration>> ForRegistration = r => new Registration
    {
        Id = r.Id,
        RegisteredAt = r.RegisteredAt,
        Status = r.Status,
        ConferenceId = r.ConferenceId,
        AttendeeId = r.AttendeeId,
        Conference = new Conference
        {
            Id = r.Conference.Id,
            Title = r.Conference.Title,
            Description = r.Conference.Description,
            Location = r.Conference.Location,
            Venue = r.Conference.Venue,
            StartDate = r.Conference.StartDate,
            EndDate = r.Conference.EndDate,
            Status = r.Conference.Status,
            MaxAttendees = r.Conference.MaxAttendees,
            OrganizerName = r.Conference.OrganizerName,
            Website = r.Conference.Website
        },
        Attendee = new Attendee
        {
            Id = r.Attendee.Id,
            FirstName = r.Attendee.FirstName,
            LastName = r.Attendee.LastName,
            Email = r.Attendee.Email
        }
    };

    public static readonly Expression<Func<Speaker, Speaker>> ForSpeaker = sp => new Speaker
    {
        Id = sp.Id,
        FirstName = sp.FirstName,
        LastName = sp.LastName,
        Bio = sp.Bio,
        Email = sp.Email,
        Sessions = sp.Sessions.OrderBy(s => s.Id).Select(s => new Session
        {
            Id = s.Id,
            Title = s.Title,
            Description = s.Description,
            StartTime = s.StartTime,
            EndTime = s.EndTime,
            Capacity = s.Capacity,
            ConferenceId = s.ConferenceId,
            SpeakerId = s.SpeakerId,
            RoomId = s.RoomId
        }).ToList()
    };
}
