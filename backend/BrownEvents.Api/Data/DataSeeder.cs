using BrownEvents.Api.Models;

namespace BrownEvents.Api.Data;

public static class DataSeeder
{
    public static async Task SeedAsync(AppDbContext context)
    {
        if (context.Conferences.Any()) return;

        var speakers = new[]
        {
            new Speaker { FirstName = "Alice", LastName = "Novak",  Bio = "Principal Engineer at CloudScale. 15 years in distributed systems.", Email = "alice.novak@example.com" },
            new Speaker { FirstName = "Ben",   LastName = "Okafor", Bio = "Author of 'Pragmatic .NET'. Microsoft MVP.", Email = "ben.okafor@example.com" },
            new Speaker { FirstName = "Chloe", LastName = "Tanaka", Bio = "Staff SRE at Observio. Reliability evangelist.", Email = "chloe.tanaka@example.com" },
        };
        context.Speakers.AddRange(speakers);
        await context.SaveChangesAsync();

        var rooms = new[]
        {
            new Room { Name = "Hall A",    Capacity = 300, Location = "Ground Floor" },
            new Room { Name = "Room 101",  Capacity = 80,  Location = "First Floor" },
            new Room { Name = "Room 202",  Capacity = 50,  Location = "Second Floor" },
            new Room { Name = "Workshop",  Capacity = 30,  Location = "Basement" },
        };
        context.Rooms.AddRange(rooms);
        await context.SaveChangesAsync();

        var conf1 = new Conference
        {
            Title = ".NET Summit 2024",
            Description = "The premier .NET conference for enterprise developers. Three tracks covering ASP.NET Core, EF Core, and cloud-native patterns.",
            Location = "Prague, Czech Republic",
            Venue = "Prague Convention Centre",
            StartDate = new DateTime(2024, 10, 14),
            EndDate   = new DateTime(2024, 10, 16),
            Status = "COMPLETED",
            MaxAttendees = 600,
            OrganizerName = "DotNet Crew",
            Website = "https://dotnetsummit.example.com"
        };

        var conf2 = new Conference
        {
            Title = "CloudOps Days",
            Description = "Kubernetes, observability, platform engineering, and SRE practices for modern infrastructure teams.",
            Location = "Amsterdam, Netherlands",
            Venue = "Beurs van Berlage",
            StartDate = new DateTime(2025, 3, 5),
            EndDate   = new DateTime(2025, 3, 6),
            Status = "UPCOMING",
            MaxAttendees = 400,
            OrganizerName = "Infra Guild"
        };

        var conf3 = new Conference
        {
            Title = "Data & AI Forum",
            Description = "Machine learning, vector databases, and LLM integrations for the working software engineer.",
            Location = "Warsaw, Poland",
            Venue = "Warsaw Expo Centre",
            StartDate = new DateTime(2025, 6, 18),
            EndDate   = new DateTime(2025, 6, 19),
            Status = "UPCOMING",
            MaxAttendees = 250,
            OrganizerName = "DataFlow Community"
        };

        context.Conferences.AddRange(conf1, conf2, conf3);
        await context.SaveChangesAsync();

        var sessions = new[]
        {
            // .NET Summit sessions
            new Session
            {
                Title = "EF Core Performance Deep Dive",
                Description = "Query profiling, batching strategies, and caching patterns for production EF Core applications.",
                StartTime = new DateTime(2024, 10, 14, 10, 0, 0),
                EndTime   = new DateTime(2024, 10, 14, 11, 0, 0),
                Capacity  = 300,
                ConferenceId = conf1.Id,
                SpeakerId    = speakers[0].Id,
                RoomId       = rooms[0].Id,
            },
            new Session
            {
                Title = "ASP.NET Core Minimal APIs in Practice",
                Description = "When to use minimal APIs over controllers, and how to structure them for production applications.",
                StartTime = new DateTime(2024, 10, 14, 11, 30, 0),
                EndTime   = new DateTime(2024, 10, 14, 12, 30, 0),
                Capacity  = 80,
                ConferenceId = conf1.Id,
                SpeakerId    = speakers[1].Id,
                RoomId       = rooms[1].Id,
            },
            new Session
            {
                Title = "Async .NET in Practice",
                Description = "Writing correct and efficient asynchronous code in .NET: patterns, pitfalls, and real-world examples.",
                StartTime = new DateTime(2024, 10, 15, 9, 0, 0),
                EndTime   = new DateTime(2024, 10, 15, 10, 0, 0),
                Capacity  = 50,
                ConferenceId = conf1.Id,
                SpeakerId    = speakers[1].Id,
                RoomId       = rooms[2].Id,
            },

            // CloudOps sessions
            new Session
            {
                Title = "Kubernetes for .NET Developers",
                Description = "Manifests, health checks, graceful shutdown, and resource limits — from a developer's perspective.",
                StartTime = new DateTime(2025, 3, 5, 10, 0, 0),
                EndTime   = new DateTime(2025, 3, 5, 11, 0, 0),
                Capacity  = 200,
                ConferenceId = conf2.Id,
                SpeakerId    = speakers[2].Id,
                RoomId       = rooms[0].Id,
            },
            new Session
            {
                Title = "OpenTelemetry End-to-End",
                Description = "Traces, metrics, logs. Instrumenting a real microservices application from zero to Grafana dashboard.",
                StartTime = new DateTime(2025, 3, 5, 14, 0, 0),
                EndTime   = new DateTime(2025, 3, 5, 15, 0, 0),
                Capacity  = 80,
                ConferenceId = conf2.Id,
                SpeakerId    = speakers[2].Id,
                RoomId       = rooms[1].Id,
            },

            // Data & AI sessions
            new Session
            {
                Title = "Building RAG Systems with .NET",
                Description = "Vector embeddings, semantic search, and retrieval-augmented generation using Microsoft.Extensions.AI.",
                StartTime = new DateTime(2025, 6, 18, 10, 0, 0),
                EndTime   = new DateTime(2025, 6, 18, 11, 30, 0),
                Capacity  = 120,
                ConferenceId = conf3.Id,
                SpeakerId    = speakers[0].Id,
                RoomId       = rooms[0].Id,
            },
            new Session
            {
                Title = "EF Core + pgvector: Vector Search in Postgres",
                Description = "Storing and querying vector embeddings inside PostgreSQL using the pgvector extension and EF Core.",
                StartTime = new DateTime(2025, 6, 18, 14, 0, 0),
                EndTime   = new DateTime(2025, 6, 18, 15, 0, 0),
                Capacity  = 50,
                ConferenceId = conf3.Id,
                SpeakerId    = speakers[1].Id,
                RoomId       = rooms[2].Id,
            },
        };

        context.Sessions.AddRange(sessions);
        await context.SaveChangesAsync();
    }
}
