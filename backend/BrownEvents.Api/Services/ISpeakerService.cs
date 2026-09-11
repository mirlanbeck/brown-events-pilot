using BrownEvents.Api.Models;

namespace BrownEvents.Api.Services;

public interface ISpeakerService
{
    Task<List<Speaker>> GetAllAsync();
    Task<Speaker> CreateAsync(Speaker speaker);
}
