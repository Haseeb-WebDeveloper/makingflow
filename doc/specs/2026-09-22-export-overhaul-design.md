# Response Export Overhaul — Design

**Status:** approved 2026-09-22. Plan: `doc/plans/2026-09-22-export-overhaul.md`.

## Where we are

One code path — `src/app/api/forms/[id]/export/route.ts` — streams every
completed response of one form as CSV, reached either from the Export button
(`submissions-view.tsx`) or from a 15-minute signed link minted by
`makingflow_export_submissions`. It is correct, tenancy-checked and
formula-safe, and it is the only export that exists.

What it cannot do, in the order it hurts:

1. **It can truncate silently.** `maxDuration = 60`, headers flushed on the
   first chunk. A large export that runs out of time lands as a *valid-looking
   CSV with HTTP 200 and missing rows* — the exact failure the route was built
   to remove.
2. **`Submitted` is the wrong timestamp.** The column is `submissions.createdAt`,
   but `submitForm` promotes a saved draft (`src/lib/actions/submissions.ts:399`),
   so for save-and-resume and conversational fills that value is when the
   respondent *started* — possibly days earlier. `completedAt` exists, unused.
3. **Scope is not selectable.** Filters and search are client-side only
   (`applyFilters` in `src/lib/submissions/filter.ts`, over the 200 loaded
   rows at most), so "Export" next to an active filter chip exports something
   other than what the owner is looking at.
4. **One format only.** No XLSX for the people who live in spreadsheets, no
   JSON for the people wiring us into something else.
5. **No way to get the uploaded files.** A job form's 200 resumes are reachable
   only by clicking 200 URLs out of a CSV.
6. **Columns owners expect do not exist:** submission id (the Sheets sync
   writes one; the CSV does not, so exports cannot be joined or deduped),
   `aiScore` / `aiSummary` / `aiScreenReason`, `calculations` (quiz result, lead
   score), `tags`, `reviewStatus`, `language`, and `meta` (UTM params,
   referrer, device, country).
7. **AI follow-up answers are dropped** — `if (!a.fieldId) continue`. The
   adaptive-AI conversation, which is the product's differentiator, is invisible
   in every export.
8. **Removing a question erases its history.** Columns come from
   non-soft-deleted fields and `answers.fieldId` is `ON DELETE SET NULL`, so
   answers to a deleted question stop exporting with no marker — though
   `answers.question` still holds the label they were given.
9. **No record of who exported what.** Bulk PII egress with no audit trail.
10. **UTC ISO strings only**, so an HR team outside UTC misreads dates.

## Decisions

### D1 — One `ExportSpec`, parsed in one place

Every export — button, dialog, MCP — is a single serialisable value:

```ts
type ExportSpec = {
  format: "csv" | "xlsx" | "json"
  scope: {
    status: "completed" | "all"      // "all" adds partials
    search?: string
    filters?: Filter[]               // Filter = FieldCondition, reused as-is
    match?: "all" | "any"
    from?: string                    // ISO date, inclusive
    to?: string                      // ISO date, inclusive
    limit?: number                   // most recent N
    order: "oldest" | "newest"
  }
  columns: {
    meta: MetaColumnKey[]            // explicit and ordered
    fields: string[] | "all"         // field ids, in form order
    removedQuestions: boolean
    aiFollowUps: boolean
  }
  files: "none" | "urls" | "zip" | "zip-only"
  timezone: string                   // IANA; default "UTC"
}
```

Defaults reproduce today's output exactly, so an un-parameterised request keeps
behaving as it does now.

### D2 — Filters are evaluated in JS, not SQL

The server imports `applyFilters` — the same pure function the table uses — and
runs it per page inside the streaming loop. Status, date range and `limit` push
down into SQL; everything else is re-evaluated in JS.

Rationale: one implementation of filter semantics for the table and the export,
no jsonb operator translation, and no chance of the two disagreeing. Cost: the
scope is fully scanned. Exports are rare and paginated, so that is the right
trade.

### D3 — Two doors, one parser

The spec arrives either as query parameters (browser, session-authenticated) or
inside the signed token payload (MCP, no session). `parseExportSpec` handles
both, so a signed link stays a shortcut past the login page and nothing more.
Keeping the spec in the query string means the download is still a plain GET —
`<a href>` and `window.location` work, no POST-to-download dance.

### D4a — Media archives ship without the queue (amended 2026-09-22)

D4 below says a media ZIP is always job work. It is not, and the reason is D7:
Cloudinary builds the archive and returns its URL in one synchronous call, so
the only work on our side is scanning the scope for assets — bounded by the
same `SYNC_ROW_CEILING` the CSV download uses. Requiring a table, a worker and
an email before a recruiter can download a CV was cost with no benefit.

Above the ceiling the request is refused with a message naming the count and
suggesting a filter or date range, rather than half-built. When the queue lands
(Phase B), media exports move onto it for the large cases and this path stays
as the fast one.

### D4 — Small exports stream; large ones become jobs

A pre-flight `COUNT(*)` decides, before a single byte is written:

- `format` is csv or json, `files` is not a zip, and the count is at or under
  `SYNC_ROW_CEILING = 5000` → stream inline, as today.
- otherwise → queue an `export_jobs` row and tell the owner we will email them.

This is what actually fixes the silent truncation: we never start a stream we
cannot finish.

### D5 — `export_jobs` is the queue *and* the audit log

Modelled on `webhook_deliveries`, down to the claim: one
`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` that flips the
status and mints a per-row `claim_token`, plus a stale-claim reclaim at the top
of each sweep. Same reasoning as `src/lib/integrations/webhook-delivery.ts`, so
read that file before touching the worker.

**Every** export writes a row, including the synchronous ones (inserted
`ready`, with `row_count`). That makes the audit trail a by-product of the
feature rather than a second thing to maintain: who exported which form, under
what spec, how many rows, when.

### D6 — Artifacts live in Cloudinary

The worker uploads the finished CSV/XLSX/JSON to Cloudinary as a `raw` asset
under `makingflow/exports`, with a random public id, and records the URL on the
job. Pruned after `ARTIFACT_TTL_DAYS = 7` by the same cron sweep, through the
existing `destroyAssets` helper.

Cloudinary is already the file store, already has server-side credentials
(`src/lib/cloudinary/delete.ts`), and this needs no new provider.

### D7 — Media ZIP via Cloudinary `generate_archive`

Collect `{storageKey, url, name, mime}` from every file/signature answer in
scope, derive `resource_type` from the stored mime with the existing
`resourceTypeFromMime` (falling back to `assetFromUrl` for rows without one),
then `POST /v1_1/<cloud>/<resource_type>/generate_archive` with
`mode=create`, `target_format=zip`, `allow_missing=true`, chunked at
`ARCHIVE_CHUNK = 200` public ids per archive. Each archive is a `part` on the
job, so one export can legitimately produce `resumes-1.zip`, `resumes-2.zip`.

Cloudinary does the byte-moving, so a 200-resume zip costs us one HTTP call
instead of 200 downloads through a 60-second route.

**Entries are named by public id, not by respondent.** Cloudinary cannot name
archive entries per-file, and `use_original_filename=true` is worse than it
looks: 200 respondents all uploading `resume.pdf` collide inside one zip.
Unique-by-construction names plus a `Files` column in the data export (holding
the exact in-zip path for each submission) loses nothing and cannot silently
drop a file. Nicely-named entries would mean zipping the bytes ourselves — see
non-goals.

**Verified against the live account on 2026-09-22**, because three details of
this API are not what a careful reading of the docs suggests:

1. **`public_ids` must be sent as repeated `public_ids[]` fields, while the
   signature is computed over the comma-joined value.** One comma-joined field
   is read as a single literal public id, matches nothing, and — with
   `allow_missing=true` — returns HTTP 200 holding a 22-byte empty zip. With
   `allow_missing` off the same request is a 400 naming every id as missing.
   This is the whole reason the archive call has a wire-shape regression test.
2. **A raw asset's public id already carries its extension**
   (`makingflow/submissions/ab12.docx`) while an image asset's does not
   (`.../ab12`, `format: pdf`) — and Cloudinary treats a PDF as an image. With
   `flatten_folders=true` the entry is the id's last segment, plus the stored
   format for image assets. So the predicted entry name takes its extension
   from the delivery URL, not from the respondent's filename.
3. **`mode=create` returns `secure_url`, `public_id`, `bytes` and `file_count`
   synchronously**, and `fl_attachment:<name>` on the delivery URL makes the
   browser save it as `<name>.zip` (confirmed: `content-disposition:
   attachment; filename="probe.zip"`).

`allow_missing` stays on, so one upload purged from storage cannot fail a
recruiter's whole download — but `file_count` is compared against the number of
assets requested, and any shortfall is reported to the owner. A zero count is
refused outright: it is always our bug, never a legitimate result.

### D8 — AI follow-ups become numbered column pairs

Answers with `is_ai_follow_up = true`, ordered per submission by
`(created_at, id)`. A pre-pass takes the maximum count over the scope so headers
are stable, then each one contributes
`AI follow-up N — question` / `AI follow-up N — answer`. In JSON they nest as
`aiFollowUps: [{ question, answer }]`.

### D9 — Removed questions are recoverable, opt-in

Answers whose `field_id` is null or points at a soft-deleted field still carry
`answers.question`. A pre-pass collects the distinct labels in scope and appends
them after the live columns as `<label> (removed)`.

### D10 — Timestamps are formatted, in a chosen timezone

`Submitted` is `completedAt` (falling back to `createdAt` for rows predating it),
`Started` is `createdAt`, both rendered with
`Intl.DateTimeFormat("sv-SE", { timeZone })` — which yields `2026-09-22 13:45:00`
with no dependency — and the header carries the zone. An `ISO (UTC)` column
stays available for machines.

### D11 — MCP parity

`makingflow_export_submissions` takes the same optional `scope` / `format` /
`files` arguments and returns either a signed link (sync-eligible) or a job id
with "the user will be emailed when it is ready". It never returns file bytes;
that reasoning is unchanged and documented in `src/lib/mcp/export-token.ts`.

## Accepted risks

- **Respondent file URLs stay public.** Uploads go through the unsigned
  Cloudinary preset, so every `answers` file URL is fetchable by anyone holding
  it, and the CSV, the Sheets sync and now the ZIP all spread it. Raised and
  explicitly accepted by the product owner on 2026-09-22: not an issue for us at
  this stage. Consequence to keep in mind: export artifacts under
  `makingflow/exports` are public too, which is why their public ids are random
  and they expire after seven days.
- **Signed export links remain replayable for their 15 minutes.** Single-use
  would break a double-click and a resumed download. Every redemption is logged
  instead (D5).
- **A filtered export scans its whole scope** (D2). Acceptable for an operation
  measured in exports-per-day.

## Non-goals

- PDF export, and per-submission "print this response".
- Respondent-named entries inside the media zip (needs us to stream the bytes;
  the 60-second ceiling and the bandwidth say no for now).
- Scheduled or recurring exports — the Google Sheets sync already is the
  continuous path.
- Signed or expiring delivery for respondent uploads (see accepted risks).
- Column *renaming*. Selecting and ordering columns, yes; editing headers, no.
