-- Initial schema for EXT-150 (spec 7.2). Written by hand: identity columns and CHECK constraints
-- cannot be expressed in schema.prisma. Table and column names are the ones EF created (spec 7.1).

CREATE TABLE "conferences" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "Title" VARCHAR(200) NOT NULL,
    "Description" VARCHAR(4000),
    "Location" VARCHAR(200),
    "Venue" VARCHAR(200),
    "StartDate" TIMESTAMP(0) NOT NULL,
    "EndDate" TIMESTAMP(0) NOT NULL,
    "Status" VARCHAR(20),
    "MaxAttendees" INTEGER,
    "OrganizerName" VARCHAR(200),
    "Website" VARCHAR(2048),
    CONSTRAINT "PK_conferences" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_conferences_Dates" CHECK ("EndDate" >= "StartDate"),
    CONSTRAINT "CK_conferences_Status" CHECK ("Status" = 'CANCELLED'),
    CONSTRAINT "CK_conferences_MaxAttendees" CHECK ("MaxAttendees" >= 1)
);

CREATE TABLE "speakers" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "FirstName" VARCHAR(100) NOT NULL,
    "LastName" VARCHAR(100) NOT NULL,
    "Bio" VARCHAR(4000),
    "Email" VARCHAR(254),
    "EmailPublic" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PK_speakers" PRIMARY KEY ("Id")
);

CREATE TABLE "rooms" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "Name" VARCHAR(100) NOT NULL,
    "Capacity" INTEGER NOT NULL,
    "Location" VARCHAR(200),
    CONSTRAINT "PK_rooms" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_rooms_Capacity" CHECK ("Capacity" >= 1)
);

CREATE TABLE "sessions" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "Title" VARCHAR(200) NOT NULL,
    "Description" VARCHAR(4000),
    "StartTime" TIMESTAMP(0) NOT NULL,
    "EndTime" TIMESTAMP(0) NOT NULL,
    "Capacity" INTEGER NOT NULL,
    "ConferenceId" INTEGER NOT NULL,
    "SpeakerId" INTEGER,
    "RoomId" INTEGER,
    CONSTRAINT "PK_sessions" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_sessions_Times" CHECK ("EndTime" > "StartTime"),
    CONSTRAINT "CK_sessions_Capacity" CHECK ("Capacity" >= 1)
);

CREATE TABLE "attendees" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "FirstName" VARCHAR(100) NOT NULL,
    "LastName" VARCHAR(100) NOT NULL,
    "Email" VARCHAR(254) NOT NULL,
    CONSTRAINT "PK_attendees" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_attendees_Email" CHECK ("Email" = lower(btrim("Email")))
);

CREATE TABLE "registrations" (
    "Id" INTEGER GENERATED ALWAYS AS IDENTITY,
    "RegisteredAt" TIMESTAMPTZ(3) NOT NULL,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    "ConferenceId" INTEGER NOT NULL,
    "AttendeeId" INTEGER NOT NULL,
    CONSTRAINT "PK_registrations" PRIMARY KEY ("Id"),
    CONSTRAINT "CK_registrations_Status" CHECK ("Status" IN ('CONFIRMED'))
);

CREATE INDEX "IX_sessions_ConferenceId" ON "sessions"("ConferenceId");
CREATE INDEX "IX_sessions_SpeakerId" ON "sessions"("SpeakerId");
CREATE INDEX "IX_sessions_RoomId" ON "sessions"("RoomId");
CREATE UNIQUE INDEX "UQ_attendees_Email" ON "attendees"("Email");
CREATE INDEX "IX_registrations_AttendeeId" ON "registrations"("AttendeeId");
CREATE UNIQUE INDEX "UQ_registrations_ConferenceId_AttendeeId" ON "registrations"("ConferenceId", "AttendeeId");

ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_conferences_ConferenceId" FOREIGN KEY ("ConferenceId") REFERENCES "conferences"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_speakers_SpeakerId" FOREIGN KEY ("SpeakerId") REFERENCES "speakers"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_rooms_RoomId" FOREIGN KEY ("RoomId") REFERENCES "rooms"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "FK_registrations_conferences_ConferenceId" FOREIGN KEY ("ConferenceId") REFERENCES "conferences"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "FK_registrations_attendees_AttendeeId" FOREIGN KEY ("AttendeeId") REFERENCES "attendees"("Id") ON DELETE RESTRICT ON UPDATE CASCADE;
