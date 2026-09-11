using BrownEvents.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace BrownEvents.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Conference> Conferences => Set<Conference>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Speaker> Speakers => Set<Speaker>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Attendee> Attendees => Set<Attendee>();
    public DbSet<Registration> Registrations => Set<Registration>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Conference>(entity =>
        {
            entity.ToTable("conferences");
            entity.HasKey(e => e.Id);
            entity.HasMany(e => e.Sessions)
                  .WithOne(s => s.Conference)
                  .HasForeignKey(s => s.ConferenceId);
            entity.HasMany(e => e.Registrations)
                  .WithOne(r => r.Conference)
                  .HasForeignKey(r => r.ConferenceId);
        });

        modelBuilder.Entity<Session>(entity =>
        {
            entity.ToTable("sessions");
            entity.HasKey(e => e.Id);
            entity.HasOne(e => e.Speaker)
                  .WithMany(s => s.Sessions)
                  .HasForeignKey(e => e.SpeakerId)
                  .IsRequired(false);
            entity.HasOne(e => e.Room)
                  .WithMany(r => r.Sessions)
                  .HasForeignKey(e => e.RoomId)
                  .IsRequired(false);
        });

        modelBuilder.Entity<Speaker>().ToTable("speakers");
        modelBuilder.Entity<Room>().ToTable("rooms");
        modelBuilder.Entity<Attendee>().ToTable("attendees");

        modelBuilder.Entity<Registration>(entity =>
        {
            entity.ToTable("registrations");
            entity.HasOne(e => e.Attendee)
                  .WithMany(a => a.Registrations)
                  .HasForeignKey(e => e.AttendeeId);
        });
    }
}
