using BrownEvents.Api.Models;
using Swashbuckle.AspNetCore.Filters;

namespace BrownEvents.Api.Swagger.Examples;

// Response examples built from the seed data (Data/DataSeeder.cs). Real responses contain the whole lazily-loaded
// object graph; here nested collections are left empty to keep the examples readable.

internal static class SampleData
{
    public static Speaker Chloe() => new()
    {
        Id = 3,
        FirstName = "Chloe",
        LastName = "Tanaka",
        Bio = "Staff SRE at Observio. Reliability evangelist.",
        Email = "chloe.tanaka@example.com"
    };

    public static Room HallA() => new() { Id = 1, Name = "Hall A", Capacity = 300, Location = "Ground Floor" };

    public static Conference CloudOps() => new()
    {
        Id = 2,
        Title = "CloudOps Days",
        Description = "Kubernetes, observability, platform engineering, and SRE practices for modern infrastructure teams.",
        Location = "Amsterdam, Netherlands",
        Venue = "Beurs van Berlage",
        StartDate = new DateTime(2025, 3, 5),
        EndDate = new DateTime(2025, 3, 6),
        Status = "UPCOMING",
        MaxAttendees = 400,
        OrganizerName = "Infra Guild"
    };

    public static Conference DotNetSummit() => new()
    {
        Id = 1,
        Title = ".NET Summit 2024",
        Description = "The premier .NET conference for enterprise developers. Three tracks covering ASP.NET Core, EF Core, and cloud-native patterns.",
        Location = "Prague, Czech Republic",
        Venue = "Prague Convention Centre",
        StartDate = new DateTime(2024, 10, 14),
        EndDate = new DateTime(2024, 10, 16),
        Status = "COMPLETED",
        MaxAttendees = 600,
        OrganizerName = "DotNet Crew",
        Website = "https://dotnetsummit.example.com"
    };

    public static Session KubernetesSession() => new()
    {
        Id = 4,
        Title = "Kubernetes for .NET Developers",
        Description = "Manifests, health checks, graceful shutdown, and resource limits — from a developer's perspective.",
        StartTime = new DateTime(2025, 3, 5, 10, 0, 0),
        EndTime = new DateTime(2025, 3, 5, 11, 0, 0),
        Capacity = 200,
        ConferenceId = 2,
        SpeakerId = 3,
        RoomId = 1,
        Speaker = Chloe(),
        Room = HallA(),
        Conference = CloudOps()
    };

    public static Registration MariaRegistration() => new()
    {
        Id = 1,
        RegisteredAt = new DateTime(2025, 2, 10, 9, 15, 42),
        Status = "CONFIRMED",
        ConferenceId = 2,
        AttendeeId = 1,
        Attendee = new Attendee { Id = 1, FirstName = "Maria", LastName = "Kowalska", Email = "maria.kowalska@example.com" },
        Conference = null!
    };
}

public class ConferenceExample : IExamplesProvider<Conference>
{
    public Conference GetExamples() => SampleData.CloudOps();
}

/// <summary>Response to <see cref="CreateConferenceRequestExample"/>.</summary>
public class CreatedConferenceExample : IExamplesProvider<Conference>
{
    public Conference GetExamples() => new()
    {
        Id = 4,
        Title = "Frontend Frontiers 2026",
        Description = "React, TypeScript and web performance for product teams.",
        Location = "Berlin, Germany",
        Venue = "Station Berlin",
        StartDate = new DateTime(2026, 11, 12),
        EndDate = new DateTime(2026, 11, 13),
        Status = "UPCOMING",
        MaxAttendees = 350,
        OrganizerName = "Web Guild",
        Website = "https://frontendfrontiers.example.com"
    };
}

/// <summary>Response to <see cref="UpdateConferenceRequestExample"/> sent to conference 2.</summary>
public class UpdatedConferenceExample : IExamplesProvider<Conference>
{
    public Conference GetExamples()
    {
        var conference = SampleData.CloudOps();
        conference.EndDate = new DateTime(2025, 3, 7);
        conference.Status = "ACTIVE";
        conference.MaxAttendees = 450;
        conference.Website = "https://cloudopsdays.example.com";
        return conference;
    }
}

public class ConferenceListExample : IExamplesProvider<List<Conference>>
{
    public List<Conference> GetExamples() => new() { SampleData.DotNetSummit(), SampleData.CloudOps() };
}

public class SessionExample : IExamplesProvider<Session>
{
    public Session GetExamples() => SampleData.KubernetesSession();
}

/// <summary>Response to <see cref="UpdateSessionRequestExample"/> sent to session 4.</summary>
public class UpdatedSessionExample : IExamplesProvider<Session>
{
    public Session GetExamples()
    {
        var session = SampleData.KubernetesSession();
        session.StartTime = new DateTime(2025, 3, 5, 10, 30, 0);
        session.EndTime = new DateTime(2025, 3, 5, 11, 30, 0);
        session.Capacity = 250;
        return session;
    }
}

public class SessionListResponseExample : IExamplesProvider<SessionListResponse>
{
    public SessionListResponse GetExamples() => new() { Data = new List<Session> { SampleData.KubernetesSession() } };
}

public class SessionResponseExample : IExamplesProvider<SessionResponse>
{
    public SessionResponse GetExamples()
    {
        // A freshly created session: navigation properties are filled only if the server already had them loaded.
        var session = SampleData.KubernetesSession();
        session.Id = 8;
        session.Title = "Platform Engineering Without the Hype";
        session.Description = "What an internal developer platform really needs on day one.";
        session.StartTime = new DateTime(2025, 3, 6, 10, 0, 0);
        session.EndTime = new DateTime(2025, 3, 6, 11, 0, 0);
        session.Capacity = 80;
        session.RoomId = 2;
        session.Room = null;
        session.Speaker = null;
        return new SessionResponse { Data = session };
    }
}

public class RegistrationExample : IExamplesProvider<Registration>
{
    public Registration GetExamples()
    {
        // Right after registering, registeredAt has not been re-read from the database: it carries "Z" and fraction digits.
        var registration = SampleData.MariaRegistration();
        registration.RegisteredAt = new DateTime(2025, 2, 10, 9, 15, 42, DateTimeKind.Utc).AddTicks(7265963);
        return registration;
    }
}

public class RegistrationListExample : IExamplesProvider<List<Registration>>
{
    public List<Registration> GetExamples() => new() { SampleData.MariaRegistration() };
}

public class SpeakerExample : IExamplesProvider<Speaker>
{
    public Speaker GetExamples() => SampleData.Chloe();
}

/// <summary>Response to <see cref="CreateSpeakerRequestExample"/>.</summary>
public class CreatedSpeakerExample : IExamplesProvider<Speaker>
{
    public Speaker GetExamples() => new()
    {
        Id = 4,
        FirstName = "Dmitri",
        LastName = "Ivanov",
        Bio = "Frontend architect, maintainer of a popular React state library.",
        Email = "dmitri.ivanov@example.com"
    };
}

public class SpeakerListExample : IExamplesProvider<List<Speaker>>
{
    public List<Speaker> GetExamples() => new() { SampleData.Chloe() };
}
