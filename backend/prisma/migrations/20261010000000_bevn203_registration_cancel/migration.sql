-- BEVN-203 (spec 3.1): a conference registration can be cancelled. The row stays (soft cancel) and comes back to
-- CONFIRMED on a new registration, so the full unique index on (ConferenceId, AttendeeId) is kept as it is.
-- One ALTER TABLE statement: Postgres applies its actions atomically, while prisma migrate deploy (7.10) does not roll
-- back the earlier statements of a migration when a later one fails (BEVN-203 spec 3.1, checked by a probe).
ALTER TABLE "registrations"
    DROP CONSTRAINT "CK_registrations_Status",
    ADD CONSTRAINT "CK_registrations_Status" CHECK ("Status" IN ('CONFIRMED', 'CANCELLED'));
