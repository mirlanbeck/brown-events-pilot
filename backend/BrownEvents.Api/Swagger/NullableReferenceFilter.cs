using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace BrownEvents.Api.Swagger;

/// <summary>
/// Marks what the serializer can emit as null when it breaks reference cycles (ReferenceHandler.IgnoreCycles):
/// navigation properties, and elements of navigation collections (e.g. <c>"sessions": [null, {...}]</c>).
/// Navigation properties come out as <c>allOf: [$ref]</c> + <c>nullable: true</c>; in OpenAPI 3.0.3 <c>nullable</c>
/// only takes effect next to an explicit <c>type</c>, so <c>type: object</c> is added. Affects the document only.
/// </summary>
public class NullableReferenceFilter : ISchemaFilter
{
    public void Apply(OpenApiSchema schema, SchemaFilterContext context)
    {
        // The envelope's `data` array is top-level in the response: its elements are never null.
        var isTopLevelEnvelope = context.Type == typeof(SessionListResponse);

        foreach (var property in schema.Properties.Values)
        {
            if (property.Nullable && property.Type is null && property.AllOf.Count > 0)
                property.Type = "object";

            if (!isTopLevelEnvelope && property.Type == "array" && property.Items?.Reference is not null)
            {
                property.Items = new OpenApiSchema
                {
                    Type = "object",
                    Nullable = true,
                    AllOf = new List<OpenApiSchema> { property.Items }
                };
            }
        }
    }
}
