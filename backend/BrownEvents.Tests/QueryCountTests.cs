using System.Data.Common;
using System.Text.Json;
using System.Text.Json.Serialization;
using BrownEvents.Api.Data;
using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace BrownEvents.Tests;

// BEVN-101 regression: the number of SQL queries per request must not depend on the number of rows.
// SQLite with lazy-loading proxies is configured like Program.cs; EF InMemory has no proxies, so the N+1 that
// happened during JSON serialization cannot be seen there (TEST-1). Each case runs on a fresh context, like a
// freshly started API, and counts the queries of the service call plus the serialization of its result.
public class QueryCountTests
{
    // Same serializer settings as AddJsonOptions in Program.cs (web defaults: camelCase).
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        ReferenceHandler = ReferenceHandler.IgnoreCycles
    };

    private sealed class QueryCounter : DbCommandInterceptor
    {
        public int Count;

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Count++;
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Count++;
            return ValueTask.FromResult(result);
        }
    }

    private record Case(Func<AppDbContext, Task>? WarmUp, Func<AppDbContext, Task<object?>> Act);

    private static readonly Dictionary<string, Case> Cases = new()
    {
        ["GET /api/conferences"] = new(null, async c => await new ConferenceService(c).GetAllAsync()),
        ["GET /api/conferences/{id}"] = new(null, async c => await new ConferenceService(c).GetByIdAsync(1)),
        ["GET /api/conferences/{id}/sessions"] = new(null, async c => new { data = await new ConferenceService(c).GetSessionsAsync(1) }),
        ["GET /api/conferences/{id}/registrations"] = new(null, async c => await new ConferenceService(c).GetRegistrationsAsync(1)),
        ["GET /api/sessions/{id}"] = new(null, async c => await new SessionService(c).GetByIdAsync(1)),
        ["GET /api/speakers"] = new(null, async c => await new SpeakerService(c).GetAllAsync()),
        ["PUT /api/conferences/{id}"] = new(null, async c => await new ConferenceService(c).UpdateAsync(1,
            new Conference { Title = "Updated", Status = "active", StartDate = new DateTime(2026, 1, 1), EndDate = new DateTime(2026, 1, 2) })),
        ["PUT /api/sessions/{id}"] = new(null, async c => await new SessionService(c).UpdateAsync(1,
            new Session { Title = "Updated", StartTime = new DateTime(2026, 1, 1, 10, 0, 0), EndTime = new DateTime(2026, 1, 1, 11, 0, 0), Capacity = 5, SpeakerId = 2, RoomId = 2 })),
        // Writes pulled related entities into the response only when the shared context already tracked them.
        ["POST /api/conferences/{id}/sessions, conference tracked"] = new(
            async c => await c.Conferences.FindAsync(1),
            async c => new { data = await new ConferenceService(c).AddSessionAsync(1,
                new Session { Title = "New", StartTime = new DateTime(2026, 1, 1, 12, 0, 0), EndTime = new DateTime(2026, 1, 1, 13, 0, 0), Capacity = 5, SpeakerId = 1, RoomId = 1 }) }),
        ["POST /api/conferences/{id}/register, conference tracked"] = new(
            async c => await c.Conferences.FindAsync(1),
            async c => await new RegistrationService(c).RegisterAttendeeAsync(1,
                new Attendee { FirstName = "New", LastName = "Attendee", Email = "new@example.com" })),
        ["POST /api/conferences/{id}/register, existing attendee"] = new(null,
            async c => await new RegistrationService(c).RegisterAttendeeAsync(2,
                new Attendee { FirstName = "Attendee", LastName = "1", Email = "attendee1@example.com" })),
    };

    public static IEnumerable<object[]> CaseNames => Cases.Keys.Select(name => new object[] { name });

    [Theory]
    [MemberData(nameof(CaseNames))]
    public async Task QueryCount_DoesNotDependOnNumberOfSessions(string caseName)
    {
        var withFew = await CountQueries(Cases[caseName], sessions: 2);
        var withMany = await CountQueries(Cases[caseName], sessions: 40);

        Assert.Equal(withFew, withMany);
    }

    [Fact]
    public async Task GetSessionsAsync_ReturnsSessionsWithDirectRelationsOnly()
    {
        using var connection = await CreateDatabase(sessions: 3);
        using var context = CreateContext(connection);

        var sessions = await new ConferenceService(context).GetSessionsAsync(1);

        Assert.Equal(3, sessions.Count);
        Assert.All(sessions, s =>
        {
            Assert.Equal($"Speaker{s.SpeakerId}", s.Speaker!.FirstName);
            Assert.Equal(s.RoomId, s.Room!.Id);
            Assert.Equal("Big Conf", s.Conference.Title);
            // Related objects are not expanded further.
            Assert.Empty(s.Speaker.Sessions);
            Assert.Empty(s.Room.Sessions);
            Assert.Empty(s.Conference.Sessions);
        });
    }

    private static async Task<int> CountQueries(Case testCase, int sessions)
    {
        using var connection = await CreateDatabase(sessions);
        var counter = new QueryCounter();
        using var context = CreateContext(connection, counter);

        if (testCase.WarmUp is not null) await testCase.WarmUp(context);
        counter.Count = 0;

        var result = await testCase.Act(context);
        JsonSerializer.Serialize(result, JsonOptions);
        return counter.Count;
    }

    private static AppDbContext CreateContext(SqliteConnection connection, QueryCounter? counter = null)
    {
        var builder = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .UseLazyLoadingProxies();
        if (counter is not null) builder.AddInterceptors(counter);
        return new AppDbContext(builder.Options);
    }

    // Conference 1 has `sessions` sessions, each with its own speaker; conference 2 has two more sessions.
    // Three attendees are registered to conference 1 and one to conference 2.
    private static async Task<SqliteConnection> CreateDatabase(int sessions)
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        await connection.OpenAsync();

        using var context = CreateContext(connection);
        await context.Database.EnsureCreatedAsync();

        var speakers = Enumerable.Range(1, sessions).Select(i => new Speaker { FirstName = $"Speaker{i}", LastName = "S" }).ToList();
        var rooms = Enumerable.Range(1, 4).Select(i => new Room { Name = $"Room {i}", Capacity = 50 }).ToList();
        var big = new Conference { Title = "Big Conf", StartDate = new DateTime(2026, 1, 1), EndDate = new DateTime(2026, 1, 2) };
        var other = new Conference { Title = "Other Conf", StartDate = new DateTime(2026, 2, 1), EndDate = new DateTime(2026, 2, 2) };
        context.AddRange(speakers);
        context.AddRange(rooms);
        context.AddRange(big, other);
        await context.SaveChangesAsync();

        for (var i = 0; i < sessions; i++)
        {
            context.Sessions.Add(new Session
            {
                Title = $"Talk {i + 1}", ConferenceId = big.Id, SpeakerId = speakers[i].Id, RoomId = rooms[i % 4].Id,
                StartTime = new DateTime(2026, 1, 1, 9, 0, 0).AddHours(i), EndTime = new DateTime(2026, 1, 1, 10, 0, 0).AddHours(i), Capacity = 50
            });
        }
        context.Sessions.Add(new Session { Title = "Other 1", ConferenceId = other.Id, SpeakerId = speakers[0].Id, RoomId = rooms[0].Id });
        context.Sessions.Add(new Session { Title = "Other 2", ConferenceId = other.Id, SpeakerId = speakers[1].Id, RoomId = rooms[1].Id });

        var attendees = Enumerable.Range(1, 3).Select(i => new Attendee { FirstName = "Attendee", LastName = $"{i}", Email = $"attendee{i}@example.com" }).ToList();
        context.AddRange(attendees);
        await context.SaveChangesAsync();

        context.Registrations.AddRange(attendees.Select(a => new Registration { ConferenceId = big.Id, AttendeeId = a.Id }));
        context.Registrations.Add(new Registration { ConferenceId = other.Id, AttendeeId = attendees[0].Id });
        await context.SaveChangesAsync();

        return connection;
    }
}
