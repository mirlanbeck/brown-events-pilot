using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace BrownEvents.Api.Swagger;

/// <summary>
/// The API only reads and writes JSON, but ApiExplorer also lists <c>text/plain</c> and <c>text/json</c>
/// (from the default MVC formatters). Keep only <c>application/json</c> in the document so Swagger UI
/// shows and sends the content type clients should actually use. Affects the document only.
/// </summary>
public class JsonOnlyContentFilter : IOperationFilter
{
    private const string Json = "application/json";

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (operation.RequestBody is not null)
            KeepJsonOnly(operation.RequestBody.Content);

        foreach (var response in operation.Responses.Values)
            KeepJsonOnly(response.Content);
    }

    private static void KeepJsonOnly(IDictionary<string, OpenApiMediaType> content)
    {
        if (!content.ContainsKey(Json)) return;

        foreach (var mediaType in content.Keys.Where(k => k != Json).ToList())
            content.Remove(mediaType);
    }
}
