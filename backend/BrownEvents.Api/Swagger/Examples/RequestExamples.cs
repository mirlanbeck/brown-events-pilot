using Swashbuckle.AspNetCore.Filters;

namespace BrownEvents.Api.Swagger.Examples;

// Request-body examples. They are anonymous objects on purpose: they contain only the fields the server
// actually reads for that endpoint, without `id` or navigation properties that the entity types would add.

public class CreateConferenceRequestExample : IExamplesProvider<object>
{
    public object GetExamples() => new
    {
        title = "Frontend Frontiers 2026",
        description = "React, TypeScript and web performance for product teams.",
        location = "Berlin, Germany",
        venue = "Station Berlin",
        startDate = new DateTime(2026, 11, 12),
        endDate = new DateTime(2026, 11, 13),
        status = "UPCOMING",
        maxAttendees = 350,
        organizerName = "Web Guild",
        website = "https://frontendfrontiers.example.com"
    };
}

public class UpdateConferenceRequestExample : IExamplesProvider<object>
{
    public object GetExamples() => new
    {
        title = "CloudOps Days",
        description = "Kubernetes, observability, platform engineering, and SRE practices for modern infrastructure teams.",
        location = "Amsterdam, Netherlands",
        venue = "Beurs van Berlage",
        startDate = new DateTime(2025, 3, 5),
        endDate = new DateTime(2025, 3, 7),
        status = "ACTIVE",
        maxAttendees = 450,
        organizerName = "Infra Guild",
        website = "https://cloudopsdays.example.com"
    };
}

public class CreateSessionRequestExample : IExamplesProvider<object>
{
    public object GetExamples() => new
    {
        title = "Platform Engineering Without the Hype",
        description = "What an internal developer platform really needs on day one.",
        startTime = new DateTime(2025, 3, 6, 10, 0, 0),
        endTime = new DateTime(2025, 3, 6, 11, 0, 0),
        capacity = 80,
        speakerId = 3,
        roomId = 2
    };
}

public class UpdateSessionRequestExample : IExamplesProvider<object>
{
    public object GetExamples() => new
    {
        title = "Kubernetes for .NET Developers",
        description = "Manifests, health checks, graceful shutdown, and resource limits — from a developer's perspective.",
        startTime = new DateTime(2025, 3, 5, 10, 30, 0),
        endTime = new DateTime(2025, 3, 5, 11, 30, 0),
        capacity = 250,
        speakerId = 3,
        roomId = 1
    };
}

public class RegisterAttendeeRequestExample : IExamplesProvider<object>
{
    public object GetExamples() => new
    {
        firstName = "Maria",
        lastName = "Kowalska",
        email = "maria.kowalska@example.com"
    };
}

public class CreateSpeakerRequestExample : IExamplesProvider<object>
{
    public object GetExamples() => new
    {
        firstName = "Dmitri",
        lastName = "Ivanov",
        bio = "Frontend architect, maintainer of a popular React state library.",
        email = "dmitri.ivanov@example.com"
    };
}
