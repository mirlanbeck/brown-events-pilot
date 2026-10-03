using BrownEvents.Api.Data;
using BrownEvents.Api.Services;
using BrownEvents.Api.Swagger;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.Filters;
using System.Reflection;
using System.Text.Json.Serialization;

AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddSingleton<AppDbContext>(sp =>
{
    var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(connectionString)
        .UseLazyLoadingProxies()
        .EnableSensitiveDataLogging();
    return new AppDbContext(optionsBuilder.Options);
});

builder.Services.AddScoped<IConferenceService, ConferenceService>();
builder.Services.AddScoped<ISessionService, SessionService>();
builder.Services.AddScoped<ISpeakerService, SpeakerService>();
builder.Services.AddScoped<IRegistrationService, RegistrationService>();

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
    });

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy
            .AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader();
    });
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc(ApiDocumentation.Version, new OpenApiInfo
    {
        Title = ApiDocumentation.Title,
        Version = ApiDocumentation.Version,
        Description = ApiDocumentation.Description
    });
    options.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, $"{Assembly.GetExecutingAssembly().GetName().Name}.xml"));
    options.ExampleFilters();
    options.OperationFilter<JsonOnlyContentFilter>();
    // Stable ids for client generators, e.g. "Conferences_GetById".
    options.CustomOperationIds(api => $"{api.ActionDescriptor.RouteValues["controller"]}_{api.ActionDescriptor.RouteValues["action"]}");
    // Lets navigation properties be marked nullable: the server emits null for them (cycle breaking, missing relations).
    options.UseAllOfToExtendReferenceSchemas();
    options.SchemaFilter<NullableReferenceFilter>();
    // Dates are serialized without an offset ("2025-03-05T10:00:00") or, for values not yet re-read from the DB, with "Z"
    // or the server's offset and up to 7 fraction digits; RFC 3339 "date-time" would reject the offset-less form.
    options.MapType<DateTime>(() => new OpenApiSchema
    {
        Type = "string",
        Pattern = @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$"
    });
});
builder.Services.AddSwaggerExamplesFromAssemblyOf<JsonOnlyContentFilter>();

var app = builder.Build();


app.UseSwagger(options =>
{
    // Advertise the host the document was requested from, so "Try it out" and generated clients target the same server.
    options.PreSerializeFilters.Add((document, request) =>
        document.Servers = new List<OpenApiServer> { new() { Url = $"{request.Scheme}://{request.Host.Value}" } });
});
app.UseSwaggerUI();

app.UseCors("AllowAll");
app.MapControllers();

// Seed demo data on startup
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    context.Database.EnsureCreated();
    await DataSeeder.SeedAsync(context);
}

app.Run();
