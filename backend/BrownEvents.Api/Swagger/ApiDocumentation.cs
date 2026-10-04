namespace BrownEvents.Api.Swagger;

/// <summary>
/// Top-level text shown in Swagger UI. Describes the API exactly as it behaves today, including its quirks,
/// so that a client can be built from Swagger alone.
/// </summary>
public static class ApiDocumentation
{
    public const string Title = "BrownEvents API";
    public const string Version = "v1";

    public const string Description = @"
Conference management API: conferences, their sessions and attendee registrations, and speakers.

**Base URL:** `http://localhost:5000` (all routes start with `/api`). No authentication. CORS allows any origin.

### Conventions
- **JSON only.** Send request bodies as `Content-Type: application/json` (`text/json` and `application/*+json` also work);
  a missing or other content type gets `415`, even for a `POST` without a body. Property names are camelCase;
  unknown properties in a request body are silently ignored.
- **Dates** are ISO 8601 strings that the server stores as plain wall-clock values (no time zone is stored or applied).
  **Send them without an offset**, e.g. `2025-03-05T10:00:00`; that is also how they are read back from the database.
  The API does not define which time zone they mean (the demo data uses the event's local time).
  - A value sent with `Z` is stored with the same digits (`10:00:00Z` → `10:00:00`).
  - A value sent with another offset is first converted to the **server's** time zone (`10:00:00+02:00` on a UTC+6 server → `14:00:00`).
  - Until a value is re-read from the database, responses echo it with an offset: `Z` (e.g. `registeredAt` of a new registration,
    which is UTC: `2026-10-03T12:41:57.7265963Z`) or the server's offset (`2025-03-05T14:00:00+06:00`). Parse all three forms.
- **Creation returns `200 OK`**, not `201 Created`, with the created object (including its new `id`).
- **Only `GET` and `POST /api/conferences/{id}/sessions` wrap the payload** as `{ ""data"": ... }`; every other endpoint returns the object or array directly.
- **`PUT` is a full replacement** of the editable fields — always send all of them. An omitted field is overwritten with its
  default: `title` → `""`, other strings → `null`, numbers → `0`, nullable numbers → `null`, dates → `0001-01-01T00:00:00`,
  conference `status` → `UPCOMING` (see each `PUT` for the field list).
- **No validation.** The server never returns `400`: missing required fields are stored as empty strings or `0`.
  An empty or malformed JSON body results in `500`.
- **`id` path parameters** are integers. A non-numeric value is treated as `0`, i.e. ""not found"".
- **`404` responses have an empty body.** List endpoints under a non-existent conference return `200` with an empty list, not `404`.
- **`500` responses have an empty body** in Production (Docker). In the Development environment the body is an error page:
  a plain-text stack trace, or HTML if the request accepts `text/html`. Do not parse it.

### Response shape
Responses are the database entities themselves, each with its **direct** related objects, which carry their own fields only:
a session comes with its `conference`, `speaker` and `room`; a conference with its `sessions` and `registrations`;
a registration with its `conference` and `attendee` (including e-mail); a speaker with its `sessions`.
Related objects are not expanded further: their own related objects are `null` or empty arrays. `speaker` and `room` are `null`
when the session has none. `POST` responses return the created object without loading related objects (a new registration includes
its `attendee`). In request bodies these navigation properties are not needed and should be omitted.
The response examples below keep nested collections empty for readability; real responses fill the direct ones.

### Known issues (temporary)
Server defects that clients may hit until they are fixed; this section is removed with the fix.
- After a write fails with `500` because of an invalid reference (non-existent conference, speaker or room),
  **every following write also fails with `500` until the API is restarted.** Reads (`GET`) keep working.
- A `PUT` that fails part-way (e.g. `""status"": null` on a conference) leaves the already-copied fields in the server's memory:
  the next successful write by any client saves them to the database, and `GET` returns them from then on.
- Changes made to the database outside the API are returned by `GET` at once, but a `PUT` of a record the API has loaded
  before still compares against the old in-memory copy: a field sent with that old value is not written. Restart the API after such changes.
";
}
