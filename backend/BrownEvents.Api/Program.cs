using BrownEvents.Api.Data;
using BrownEvents.Api.Services;
using Microsoft.EntityFrameworkCore;
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
builder.Services.AddSwaggerGen();

var app = builder.Build();


app.UseSwagger();
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
