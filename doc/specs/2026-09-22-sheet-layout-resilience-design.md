# Sheet Layout Resilience — Design

**Plan:** `doc/plans/2026-09-22-sheet-layout-resilience.md`

**Status:** approved, 2026-09-22

## The problem

The Google Sheets sync is *positional*. It assumes three things about the
spreadsheet it writes to, none of which the owner has agreed to leave alone:

1. The header is row 1.
2. The Submission ID is column A.
3. Answers belong in `config.columns` order, starting at column A.

Every one of those is a click away from being false, and when it became false
the failure was silent. Three bugs, reported from one live spreadsheet.

### 1. New submissions landed above the header

`appendRows` (`google.ts:247-260`) posts to
`values/Submissions!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`.
`values.append` does not simply write to the bottom — it *searches the given
range for a table* and appends after the last row of it. With `A1` empty, there
is no table, so "the next row of the table" resolves to row 1.

Observed: header in row 2, newest submission in row 1, every earlier response
below. The owner had inserted a row above the header while restyling it.

### 2. The displaced header silently corrupts three lookups

Three sites treat row 1 as the header and skip it:

| Site | Code | Consequence when the header is not row 1 |
|---|---|---|
| `sync.ts:264` | `present.slice(1).includes(submissionId)` | Retry dedup drops a real submission id → a retried delivery appends a **duplicate row** |
| `sync.ts:425` | `getColumnValues(...).slice(1)` | Backfill dedup does the same → duplicates on re-enable |
| `sync.ts:513` | `ids.findIndex((v, i) => i > 0 && ...)` | The row-1 submission can **never be deleted** from the sheet |

### 3. Any column edit misaligns every future row

Rows are built as `[submissionId, submittedAt, ...columns]` (`sync.ts:271-277`)
and written from column A. A column inserted mid-sheet shifts the *headers* but
not the *writes*, so from that moment every row is off by one relative to its
labels. A column inserted before A breaks id tracking outright.

### 4. Renaming the tab breaks sync entirely

Every range is `` `${sheetName}!...` `` built from `config.sheetName`, captured
at provisioning time (`sync.ts:248`, `:420`, `:505`; `sheets-provision.ts:136`).
Rename the tab and Sheets answers with a range-parse error on every delivery.

## The approach

Stop storing positions. Resolve them.

Each column MakingFlow owns, and the header row, carries a Google **Developer
Metadata** tag — an invisible key/value pair attached to a dimension. Sheets
moves the tag with the dimension through inserts, deletes and reorders. One
`developerMetadata.search` call per sync returns where everything is *now*.

Every read and write then addresses cells by `sheetId` + 0-based grid index
rather than an A1 range, and appends use `AppendCellsRequest` instead of
`values.append`.

### Tag scheme

| Key | Value | Attached to |
|---|---|---|
| `makingflow.row` | `header` | the header row (ROWS) |
| `makingflow.col` | `id` | the Submission ID column (COLUMNS) |
| `makingflow.col` | `ts` | the Submitted at column (COLUMNS) |
| `makingflow.col` | `f:<fieldId>` | that question's column (COLUMNS) |

Two keys means one search request with two `dataFilters` returns the entire
layout — header row and every column — in a single round trip.

### Why this is safe to build

Verified against Google's documentation before planning:

- **Scope.** `https://www.googleapis.com/auth/drive.file` is a listed
  authorization scope for `spreadsheets.developerMetadata.search`. The existing
  grant (`google.ts:27-31`) already covers it: **no re-consent, no broader
  access, `GOOGLE_SCOPES` does not change.**
- **Metadata follows its dimension.** *"Developer metadata remains associated at
  locations as they move around and the spreadsheet is edited. For example, if
  developer metadata is associated with row 5 and another row is then
  subsequently inserted above row 5, that original metadata will still be
  associated with the row it was first associated with (what is now row 6). If
  the associated object is deleted its metadata is deleted too."*
- **`AppendCellsRequest`** "adds new cells after the last row with data in a
  sheet" — sheet-level, explicitly not the table detection `values.append` uses.
  A blank row above the header cannot pull a write to the top.
- **Storage limit** is 30,000 characters per spreadsheet. Our tags run ~45
  characters; 100 questions is ~4.5 KB. Not a constraint.

### Decisions

| Decision | Choice | Why |
|---|---|---|
| Append position | **Bottom, always** | The correct default. Now guaranteed structurally rather than by luck. |
| Damage past auto-repair | **Self-heal and keep delivering**, `console.warn` | Never lose a response to a layout problem. |
| Notion sync | **Out of scope** | Same class of coupling, separate plan. |
| Metadata visibility | **`DOCUMENT`** | Survives a Google Cloud project change, which `PROJECT` visibility would silently hide from us. Keys are namespaced; values are internal field UUIDs. |
| Concurrent repair | **Leftmost-wins convergence**, not a lock | Supabase connection pooling makes session-level advisory locks unreliable. Duplicate tags dedup deterministically; the stray is cleaned on the next reconcile. |

The concurrency point matters: deliveries are claimed with `FOR UPDATE SKIP
LOCKED` and run ten at a time (`webhook-delivery.ts:41`, `:427-430`), with
**nothing serialized per form**. Two responses to the same form can reconcile
and append simultaneously. `appendCells` is atomic server-side, which removes
the write race; leftmost-wins removes the repair race.

## Known limitations

1. **Deleting a MakingFlow column loses that column's history.** The column is
   re-created empty on the next sync. The data was in the cells that were
   removed.
2. **Metadata does not survive download-and-re-upload.** An exported-then-
   reimported file is a new spreadsheet with no tags; it is re-migrated
   automatically on the next sync. "Make a copy" within Drive does carry tags.
3. **A user column placed *between* MakingFlow columns receives an empty value
   on each new row**, so an `ARRAYFORMULA` there will not auto-fill. Derived
   columns belong to the **right** of all MakingFlow columns, where appended
   rows are trimmed and the cells are never touched.

## Migration

Sheets provisioned before this change carry no tags. On the next reconcile they
are migrated **in place** — no column is inserted, no row is moved, no data
shifts:

1. Read the first 20 rows.
2. Find the header row: the first row containing `Submission ID`, else the first
   containing `Submitted at`, else row 0.
3. Match that row's cell text against the stored `config.columns` labels to map
   each `fieldId` onto its physical column.
4. Write tags for everything matched, plus the header row. Unmatched fields fall
   through to the normal repair path and get a new column at the end.

Rollback is clean: every new path is guarded by `if (layout)` with the previous
positional code as the `else`. Reverting restores the old behaviour, and tags
left behind in users' sheets are inert and invisible.
