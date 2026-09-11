using BrownEvents.Api.Data;
using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace BrownEvents.Tests;

public class SessionServiceTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static Session CreateSession(AppDbContext context)
    {
        var conf = new Conference
        {
            Title = "Test Conf",
            StartDate = DateTime.UtcNow,
            EndDate = DateTime.UtcNow.AddDays(1),
            Status = "UPCOMING"
        };
        context.Conferences.Add(conf);
        context.SaveChanges();

        var session = new Session
        {
            Title = "Test Session",
            ConferenceId = conf.Id,
            StartTime = DateTime.UtcNow,
            EndTime = DateTime.UtcNow.AddHours(1),
            Capacity = 100
        };
        context.Sessions.Add(session);
        context.SaveChanges();
        return session;
    }

    [Fact]
    public async Task UpdateAsync_ChangesSessionTitle()
    {
        using var context = CreateContext();
        var session = CreateSession(context);

        var service = new SessionService(context);
        var updated = new Session
        {
            Title = "Updated Title",
            StartTime = session.StartTime,
            EndTime = session.EndTime,
            Capacity = 200,
            SpeakerId = null,
            RoomId = null
        };

        var result = await service.UpdateAsync(session.Id, updated);

        Assert.NotNull(result);
        Assert.Equal("Updated Title", result!.Title);
        Assert.Equal(200, result.Capacity);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNull_WhenNotFound()
    {
        using var context = CreateContext();
        var service = new SessionService(context);

        var result = await service.UpdateAsync(9999, new Session
        {
            Title = "Ghost",
            StartTime = DateTime.UtcNow,
            EndTime = DateTime.UtcNow.AddHours(1),
            Capacity = 10
        });

        Assert.Null(result);
    }
}
