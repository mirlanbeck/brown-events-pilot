using BrownEvents.Api.Data;
using BrownEvents.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace BrownEvents.Api.Services;

public class SpeakerService : ISpeakerService
{
    private readonly AppDbContext _context;

    public SpeakerService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<List<Speaker>> GetAllAsync()
    {
        return await _context.Speakers.ToListAsync();
    }

    public async Task<Speaker> CreateAsync(Speaker speaker)
    {
        _context.Speakers.Add(speaker);
        await _context.SaveChangesAsync();
        return speaker;
    }
}
