using BrownEvents.Api.Data;
using BrownEvents.Api.Models;
using BrownEvents.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace BrownEvents.Tests;

public class ConferenceServiceTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public async Task GetAllAsync_ReturnsAllConferences()
    {
        using var context = CreateContext();
        context.Conferences.AddRange(
            new Conference { Title = "Conf A", StartDate = DateTime.UtcNow, EndDate = DateTime.UtcNow.AddDays(1), Status = "UPCOMING" },
            new Conference { Title = "Conf B", StartDate = DateTime.UtcNow, EndDate = DateTime.UtcNow.AddDays(2), Status = "UPCOMING" }
        );
        await context.SaveChangesAsync();

        var service = new ConferenceService(context);
        var result = await service.GetAllAsync();

        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task CreateAsync_PersistsConference()
    {
        using var context = CreateContext();
        var service = new ConferenceService(context);

        var conf = new Conference
        {
            Title = "New Conf",
            StartDate = DateTime.UtcNow,
            EndDate = DateTime.UtcNow.AddDays(1),
            Status = "UPCOMING"
        };

        var result = await service.CreateAsync(conf);

        Assert.True(result.Id > 0);
        Assert.Equal("New Conf", result.Title);
    }

    [Fact]
    public async Task UpdateAsync_ChangesTitle()
    {
        using var context = CreateContext();
        var existing = new Conference
        {
            Title = "Old Title",
            StartDate = DateTime.UtcNow,
            EndDate = DateTime.UtcNow.AddDays(1),
            Status = "UPCOMING"
        };
        context.Conferences.Add(existing);
        await context.SaveChangesAsync();

        var service = new ConferenceService(context);
        var updated = new Conference
        {
            Title = "New Title",
            StartDate = existing.StartDate,
            EndDate = existing.EndDate,
            Status = "active"
        };

        var result = await service.UpdateAsync(existing.Id, updated);

        Assert.NotNull(result);
        Assert.Equal("New Title", result!.Title);
        Assert.Equal("ACTIVE", result.Status);
    }

    [Fact]
    public async Task UpdateAsync_ReturnsNull_WhenNotFound()
    {
        using var context = CreateContext();
        var service = new ConferenceService(context);

        var result = await service.UpdateAsync(999, new Conference { Title = "X", Status = "UPCOMING" });

        Assert.Null(result);
    }

    [Fact]
    public async Task GetSessionsAsync_ReturnsOnlyConferenceSessions()
    {
        using var context = CreateContext();
        var conf1 = new Conference { Title = "C1", StartDate = DateTime.UtcNow, EndDate = DateTime.UtcNow.AddDays(1), Status = "UPCOMING" };
        var conf2 = new Conference { Title = "C2", StartDate = DateTime.UtcNow, EndDate = DateTime.UtcNow.AddDays(1), Status = "UPCOMING" };
        context.Conferences.AddRange(conf1, conf2);
        await context.SaveChangesAsync();

        context.Sessions.AddRange(
            new Session { Title = "S1", ConferenceId = conf1.Id, StartTime = DateTime.UtcNow, EndTime = DateTime.UtcNow.AddHours(1), Capacity = 50 },
            new Session { Title = "S2", ConferenceId = conf1.Id, StartTime = DateTime.UtcNow, EndTime = DateTime.UtcNow.AddHours(1), Capacity = 50 },
            new Session { Title = "S3", ConferenceId = conf2.Id, StartTime = DateTime.UtcNow, EndTime = DateTime.UtcNow.AddHours(1), Capacity = 50 }
        );
        await context.SaveChangesAsync();

        var service = new ConferenceService(context);
        var result = await service.GetSessionsAsync(conf1.Id);

        Assert.Equal(2, result.Count);
        Assert.All(result, s => Assert.Equal(conf1.Id, s.ConferenceId));
    }
}
