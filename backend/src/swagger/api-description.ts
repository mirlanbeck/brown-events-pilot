export const API_DESCRIPTION = `
BrownEvents conference API (NestJS since EXT-150). Base URL: the server that served this document; all routes start with \`/api\`.
No authentication. CORS allows only the origins configured in \`CORS_ORIGINS\`.

### Conventions
- **JSON only.** \`POST\`/\`PUT\` need \`Content-Type: application/json\` (parameters allowed) or \`application/*+json\`; anything else,
  including \`text/json\`, is **415**. Bodies are limited to 100 kB (**413**).
- **Strict bodies.** Unknown properties are rejected with **400** naming the property (property names are case-sensitive camelCase).
  The registration endpoint also accepts \`phone\`, \`company\`, \`dietaryRequirements\` and \`sessionId\` from the frontend forms; they are not stored.
- **Responses** are bare objects and arrays (no \`{data}\` wrapper). A record comes with its direct relations, each with its own fields only.
  \`POST\` answers **201** with the created resource; conferences and sessions also send \`Location\`.
- **PUT is a full replacement:** every writable property must be present; \`null\` clears a nullable one. \`id\` and relations are read-only.
- **Ids in paths** are integers from 1 to 2147483647; anything else is **400**. A missing record or parent is **404**.
- **Dates.** \`startDate\`, \`endDate\`, \`startTime\`, \`endTime\` are venue wall-clock times \`YYYY-MM-DDTHH:mm:ss\` without offset or fraction,
  in requests and responses; values with \`Z\` or an offset are **400**. \`registeredAt\` is a UTC instant with \`Z\` and milliseconds.
- **Conference status** is derived from the dates: UPCOMING before the first day, ACTIVE until the end of the last day (\`endDate\` holds
  midnight at the start of the last day), then COMPLETED; CANCELLED if cancelled. In requests send \`CANCELLED\`, \`null\`, or the status
  that matches the dates (anything else is **400**). The day boundary is computed in UTC, so it can be off by up to 14 hours.
- **Registration** is open while the conference is UPCOMING or ACTIVE and has seats; a repeat, a full or closed conference is **409**.
  Emails are trimmed and lower-cased, must be ASCII and identify the attendee; an existing attendee keeps the stored name.
- **Personal data.** Attendee emails are never returned. A speaker email is returned only if \`emailPublic\` is true, otherwise it is \`null\`.
- **Sessions** must take place within the conference days (**422**), their capacity must not exceed the room capacity (**422**),
  \`speakerId\`/\`roomId\` must exist (**422**). Rooms have no endpoint; the seeded rooms have ids 1-4.
- **Session registration.** \`POST /api/sessions/{id}/register\`, \`/waitlist\` and \`/cancel\` take \`{ email }\`. Register and waitlist
  need a confirmed conference registration; cancel needs an active entry on the session, otherwise **404**. Registering for a full session is **409** \`SESSION_FULL\` (no automatic waitlist place); the
  waitlist accepts attendees only while the session is full. Cancelling a confirmed place gives it to the first on the waitlist
  (by \`createdAt\`, then \`id\`). Seats added or opened again by a \`PUT\` of the session or the conference go to the waitlist the same way. Open while the conference is UPCOMING or ACTIVE and the session has not started (its start time is
  compared as UTC). An attendee cannot hold overlapping sessions of one conference. \`GET /api/sessions/{id}\` adds
  \`registeredCount\` and \`waitlistCount\`.
- **Errors** are JSON: \`{ statusCode, error, message, requestId, reason?, errors? }\`; \`errors\` lists failed fields for 400 and 422;
  \`reason\` is a code on the 409 answers of the session registration endpoints.
  \`requestId\` equals the \`X-Request-Id\` header. A wrong method on a known path is **405** with \`Allow\`.
  **503** with \`Retry-After\` means the database was busy or unreachable: retry.
`;
