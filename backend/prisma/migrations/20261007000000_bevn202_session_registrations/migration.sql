-- BEVN-202 (spec 3): session registrations and waitlists. Written by hand like the init migration:
-- the identity column and the CHECK constraint cannot be expressed in schema.prisma.

CREATE TABLE "session_registrations" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "SessionId" INTEGER NOT NULL,
    "AttendeeId" INTEGER NOT NULL,
    "Status" VARCHAR(20) NOT NULL,
    "CreatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PK_session_registrations" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_session_registrations_Status" CHECK ("Status" IN ('CONFIRMED', 'WAITLISTED', 'CANCELLED'))
);

CREATE UNIQUE INDEX "UQ_session_registrations_SessionId_AttendeeId_Active" ON "session_registrations"("SessionId", "AttendeeId") WHERE "Status" <> 'CANCELLED';
CREATE INDEX "IX_session_registrations_SessionId_Status_CreatedAt" ON "session_registrations"("SessionId", "Status", "CreatedAt", "Id");
CREATE INDEX "IX_session_registrations_AttendeeId" ON "session_registrations"("AttendeeId");

ALTER TABLE "session_registrations" ADD CONSTRAINT "FK_session_registrations_sessions_SessionId" FOREIGN KEY ("SessionId") REFERENCES "sessions"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_registrations" ADD CONSTRAINT "FK_session_registrations_attendees_AttendeeId" FOREIGN KEY ("AttendeeId") REFERENCES "attendees"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
