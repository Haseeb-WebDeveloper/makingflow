-- Two partial unique indexes that make concurrency-sensitive rules the
-- database's job instead of a read-then-write check in application code.
--
-- Both need the existing data reconciled first: a unique index cannot be built
-- over rows that already violate it, and both violations are ones the old code
-- could actually produce.

-- ── 1. One Sheets / Notion destination per form ─────────────────────────────
-- Those two integrations are provisioned lazily on a form's first response.
-- Concurrent first responses each created a spreadsheet/database and inserted
-- a row, so a busy form can already have several. Keep the OLDEST row per
-- (form, type) — it's the one earlier reads settled on and the one whose
-- destination holds the backfilled history — and drop the orphan rows. The
-- remote spreadsheets/databases they pointed at are left untouched in the
-- user's Drive/Notion rather than deleted from under them.
DELETE FROM "form_integrations" a
USING "form_integrations" b
WHERE a."type" IN ('google_sheets', 'notion')
  AND b."type" = a."type"
  AND b."form_id" = a."form_id"
  AND (b."created_at", b."id") < (a."created_at", a."id");
--> statement-breakpoint
CREATE UNIQUE INDEX "form_integrations_singleton_idx" ON "form_integrations" USING btree ("form_id","type") WHERE "form_integrations"."type" IN ('google_sheets', 'notion');--> statement-breakpoint

-- ── 2. One completed response per respondent, per form ──────────────────────
-- Only applies to forms with `one_response_per_person` on, which is where the
-- old COUNT-then-insert let simultaneous submits from one respondent all land.
--
-- We do NOT delete the duplicates: they are real responses someone actually
-- submitted, and dropping them to satisfy a new constraint would lose data.
-- Instead we clear `respondent_key` on all but the earliest of each group. The
-- column exists solely to enforce this rule going forward, so a historical row
-- without one simply isn't counted against a future submission.
UPDATE "submissions" a
SET "respondent_key" = NULL
FROM "submissions" b
WHERE a."status" = 'completed'
  AND a."respondent_key" IS NOT NULL
  AND b."status" = 'completed'
  AND b."respondent_key" = a."respondent_key"
  AND b."form_id" = a."form_id"
  AND (b."created_at", b."id") < (a."created_at", a."id");
--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_form_respondent_unique_idx" ON "submissions" USING btree ("form_id","respondent_key") WHERE "submissions"."status" = 'completed' AND "submissions"."respondent_key" IS NOT NULL;
