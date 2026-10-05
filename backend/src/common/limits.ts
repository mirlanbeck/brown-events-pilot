export const INT32_MAX = 2_147_483_647;

// One table for the database (prisma/schema.prisma @db.VarChar(n)) and the DTOs (@MaxLength(n)).
// test/integration/schema.e2e-spec.ts checks that the columns match it.
export const LIMITS = {
  conferences: { Title: 200, Description: 4000, Location: 200, Venue: 200, OrganizerName: 200, Website: 2048, Status: 20 },
  sessions: { Title: 200, Description: 4000 },
  speakers: { FirstName: 100, LastName: 100, Bio: 4000, Email: 254 },
  rooms: { Name: 100, Location: 200 },
  attendees: { FirstName: 100, LastName: 100, Email: 254 },
  registrations: { Status: 20 },
  // Accepted from the registration forms but not stored (spec 5.4): limits exist only in the DTO.
  registerForm: { phone: 50, company: 200, dietaryRequirements: 1000 },
} as const;
