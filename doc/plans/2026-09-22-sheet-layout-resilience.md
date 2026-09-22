# Sheet Layout Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Sheets sync correct no matter how the owner edits their spreadsheet — hidden columns, columns inserted or reordered anywhere, a displaced header row, a renamed tab — with every new submission landing as one complete row at the **bottom**.

**Architecture:** The sync is currently *positional*: it assumes the header is row 1, the Submission ID is column A, and answers go in stored-config order starting at column A. Replace that with *resolved* positions. Tag each MakingFlow-owned column and the header row with Google **Developer Metadata** (invisible tags that Sheets moves along with the dimension), then resolve the live layout on every sync via one `developerMetadata.search` call. Address every read and write by `sheetId` + grid index instead of an A1 range, and append with `AppendCellsRequest` instead of `values.append`.

**Tech Stack:** TypeScript, Next.js 16, Drizzle, Vitest (`unit` + `integration` projects), Google Sheets API v4 REST (called directly via `fetch` in `src/lib/integrations/google.ts` — no googleapis SDK).

**Spec:** `doc/specs/2026-09-22-sheet-layout-resilience-design.md`

---

## Context

Three production bugs, one root cause.

1. **New submissions landed above the header.** A blank row above the header made `values.append`'s table detection resolve "the next row of the table" to row 1. Confirmed from a live sheet: header in row 2, newest submission in row 1.
2. **The displaced header silently corrupts three lookups.** `sync.ts:264`, `sync.ts:425` and `sync.ts:513` all assume row 1 is the header (`.slice(1)`, `i > 0`). With data in row 1, retry dedup drops a real submission ID (→ duplicate rows on retry), backfill dedup does the same, and `deleteSubmissionFromSheet` can never remove that row.
3. **Any column edit misaligns future rows.** Rows are written as `[id, submittedAt, ...columns]` into A, B, C… A column inserted mid-sheet shifts the headers but not the writes, so every subsequent row is off by one. A column inserted before A breaks ID tracking entirely.

Additionally, a renamed tab breaks sync outright — every range is built as `` `${sheetName}!A1` `` from a name stored at provisioning time.

Intended outcome: the owner can treat the sheet as a normal spreadsheet. Hide, reorder, insert, restyle, rename the tab — the next submission still arrives as one correct row at the bottom, with the Submission ID in its own (possibly hidden) column.

### Verified before planning

- `https://www.googleapis.com/auth/drive.file` is a **listed scope** for `spreadsheets.developerMetadata.search`. The existing grant (`google.ts:27-31`) is sufficient — **no re-consent, no broader access**.
- Google's docs: *"Developer metadata remains associated at locations as they move around and the spreadsheet is edited… if developer metadata is associated with row 5 and another row is then subsequently inserted above row 5, that original metadata will still be associated with the row it was first associated with (what is now row 6). If the associated object is deleted its metadata is deleted too."*
- `AppendCellsRequest` "adds new cells after the last row with data in a sheet" — sheet-level, explicitly **not** the table detection `values.append` uses.
- Metadata storage limit: 30,000 characters per spreadsheet. Our tags are ~45 chars each; 100 questions ≈ 4.5 KB. Comfortable.

### Decisions taken (no further input needed)

| Decision | Choice | Why |
|---|---|---|
| Append position | **Bottom, always** | The correct default. `appendCells` guarantees it structurally. |
| Damage past auto-repair (owner deletes the header row or a MakingFlow column) | **Self-heal and keep delivering**, warn via `console.warn` | Never lose a response to a layout problem. Re-created columns are blank for historical rows — that data was in the deleted cells and is genuinely gone. |
| Notion sync | **Out of scope** | Same class of coupling, but a separate plan. This one stays shippable. |
| Metadata visibility | **`DOCUMENT`** | Survives a Google Cloud project change, unlike `PROJECT`. Keys are namespaced `makingflow.*`; values are internal field UUIDs, nothing sensitive. |
| Concurrent repair of the same sheet | **Leftmost-wins convergence**, not a lock | Supabase connection pooling makes session-level advisory locks unreliable. Duplicate tags are deduped deterministically and the extra tag cleaned on the next reconcile. |

## Global Constraints

- `import "server-only"` at the top of every file under `src/lib/integrations/`.
- Style: double quotes, **no semicolons**, and a multi-paragraph block comment at the top of each new file and test file stating *the failure it exists to prevent* (repo convention — see `sheets-account-switch.test.ts:14-17`).
- Test names are full sentences describing behaviour, never `should`-prefixed.
- Vitest with `globals: false` — every test file imports `describe/test/expect/vi` explicitly from `"vitest"`.
- Never introduce the `googleapis` SDK. All Google I/O is `fetch` inside `google.ts`.
- `GOOGLE_SCOPES` must not change. Any design needing a new scope is wrong.
- All new Sheets I/O addresses cells by `sheetId` + 0-based grid index. **No new A1-notation ranges.**
- Multi-tenant: every DB read stays scoped by `workspaceId` / `formId` exactly as today.

---

## File Structure

| File | Responsibility |
|---|---|
| **Create** `src/lib/integrations/sheet-layout.ts` | Pure core. Tag keys, parsing a metadata search into a `SheetLayout`, planning repairs, and building `batchUpdate` request objects. No I/O, no DB — fully unit-testable without mocks. |
| **Modify** `src/lib/integrations/google.ts` | Add grid-addressed primitives: `searchDeveloperMetadata`, `runBatchUpdate` (export the existing private `batchUpdate`), `appendCells`, `readGridColumn`. Keep existing exports so current tests and callers keep compiling. |
| **Modify** `src/lib/integrations/sheets-provision.ts` | `createFormSheet` tags on create; `reconcileFormSheet` resolves the live layout, migrates untagged sheets, and repairs damage. Returns a `SheetLayout`. |
| **Modify** `src/lib/integrations/sync.ts` | Build rows from the resolved layout; ID lookups and row deletion via the layout instead of hardcoded column A / row 1. |
| **Create** `tests/unit/sheet-layout.test.ts` | The pure core — the bulk of the coverage. |
| **Create** `tests/unit/sheets-grid-api.test.ts` | The new `google.ts` primitives against a stubbed global `fetch` (mirrors `tests/unit/drive-share.test.ts`). |
| **Create** `tests/integration/sheets-layout-resilience.test.ts` | End-to-end per damage scenario against a fake in-memory spreadsheet. |

The pure/impure split is the point: every rule that can be got wrong lives in `sheet-layout.ts` and is tested with plain function calls.

---

## Task 0: Spec document

**Files:**
- Create: `doc/specs/2026-09-22-sheet-layout-resilience-design.md`

- [ ] **Step 1:** Write the design doc capturing the **Context** section above verbatim (the three bugs with their `file:line` evidence, the four verified API facts, and the decisions table). Add a "Known limitations" section with exactly these three entries:
  - Deleting a MakingFlow column loses that column's history; it is re-created empty.
  - Developer metadata does not survive download-and-re-upload (a new file has no tags). "Make a copy" in Drive does carry them. An untagged sheet is re-migrated automatically.
  - A user column placed **between** MakingFlow columns receives an empty value on each new row, so an `ARRAYFORMULA` there will not auto-fill. Derived columns belong to the **right** of all MakingFlow columns, where rows are trimmed and never touched.
- [ ] **Step 2:** Copy this plan to `doc/plans/2026-09-22-sheet-layout-resilience.md` and cross-link the two with a `**Spec:**` / `**Plan:**` line each, matching `doc/plans/2026-09-22-sheets-member-access.md`.
- [ ] **Step 3:** Commit.

```bash
git add doc/specs/2026-09-22-sheet-layout-resilience-design.md doc/plans/2026-09-22-sheet-layout-resilience.md
git commit -m "doc(sheets): design for layout-resilient spreadsheet sync"
```

---

## Task 1: Layout resolution (pure)

**Files:**
- Create: `src/lib/integrations/sheet-layout.ts`
- Test: `tests/unit/sheet-layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const TAG_COLUMN = "makingflow.col"
  export const TAG_ROW = "makingflow.row"
  export const TAG_KEYS: readonly string[]          // [TAG_COLUMN, TAG_ROW]
  export const ID_TAG = "id"
  export const TIMESTAMP_TAG = "ts"
  export const HEADER_TAG = "header"
  export function fieldTag(fieldId: string): string   // `f:${fieldId}`
  export function parseFieldTag(value: string): string | null

  export type MetadataTag = {
    key: string
    value: string
    dimension: "ROWS" | "COLUMNS"
    /** 0-based, inclusive. */
    index: number
    sheetId: number
  }

  export type SheetLayout = {
    sheetId: number
    headerRow: number
    idColumn: number
    timestampColumn: number
    /** fieldId -> 0-based column index */
    fieldColumns: Map<string, number>
    /** Highest owned column index, for trimming appended rows. */
    lastColumn: number
  }

  export function resolveLayout(tags: MetadataTag[], sheetId: number): SheetLayout | null
  ```

`resolveLayout` returns `null` when the sheet carries no usable tags (→ the caller migrates). Duplicate tags for the same logical column resolve **leftmost-wins**, so two racing repairs converge instead of diverging.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest"
import {
  fieldTag,
  parseFieldTag,
  resolveLayout,
  type MetadataTag,
} from "@/lib/integrations/sheet-layout"

/** A COLUMNS tag at `index` carrying `value`. */
function col(value: string, index: number, sheetId = 0): MetadataTag {
  return { key: "makingflow.col", value, dimension: "COLUMNS", index, sheetId }
}
/** A ROWS tag at `index`. */
function row(value: string, index: number, sheetId = 0): MetadataTag {
  return { key: "makingflow.row", value, dimension: "ROWS", index, sheetId }
}

describe("fieldTag", () => {
  test("round-trips a field id", () => {
    expect(parseFieldTag(fieldTag("abc-123"))).toBe("abc-123")
  })

  test("ignores a tag that is not a field", () => {
    expect(parseFieldTag("id")).toBeNull()
    expect(parseFieldTag("ts")).toBeNull()
  })
})

describe("resolveLayout", () => {
  test("reads the layout of an untouched sheet", () => {
    const layout = resolveLayout(
      [row("header", 0), col("id", 0), col("ts", 1), col(fieldTag("f1"), 2), col(fieldTag("f2"), 3)],
      0,
    )
    expect(layout).toEqual({
      sheetId: 0,
      headerRow: 0,
      idColumn: 0,
      timestampColumn: 1,
      fieldColumns: new Map([["f1", 2], ["f2", 3]]),
      lastColumn: 3,
    })
  })

  // The whole point of the feature: Sheets moves the tags, we just read them.
  test("follows columns the owner reordered and a header the owner pushed down", () => {
    const layout = resolveLayout(
      [row("header", 4), col("id", 7), col("ts", 0), col(fieldTag("f1"), 3), col(fieldTag("f2"), 1)],
      0,
    )
    expect(layout?.headerRow).toBe(4)
    expect(layout?.idColumn).toBe(7)
    expect(layout?.timestampColumn).toBe(0)
    expect(layout?.fieldColumns.get("f1")).toBe(3)
    expect(layout?.lastColumn).toBe(7)
  })

  // Two deliveries repairing the same sheet at once can each create a column.
  // Diverging here would mean rows written to different columns per worker.
  test("resolves a duplicated tag to the leftmost column so racing repairs converge", () => {
    const layout = resolveLayout(
      [row("header", 0), col("id", 0), col("ts", 1), col(fieldTag("f1"), 5), col(fieldTag("f1"), 2)],
      0,
    )
    expect(layout?.fieldColumns.get("f1")).toBe(2)
  })

  test("ignores tags belonging to another tab", () => {
    const layout = resolveLayout(
      [row("header", 0), col("id", 0), col("ts", 1), col(fieldTag("f1"), 9, 77)],
      0,
    )
    expect(layout?.fieldColumns.has("f1")).toBe(false)
  })

  test("is null when the sheet carries no tags at all", () => {
    expect(resolveLayout([], 0)).toBeNull()
  })

  // Without the id column there is no way to dedup or delete a row, so the
  // caller must migrate rather than write blind.
  test("is null when the id column tag is missing", () => {
    expect(resolveLayout([row("header", 0), col("ts", 1)], 0)).toBeNull()
  })

  test("is null when the header row tag is missing", () => {
    expect(resolveLayout([col("id", 0), col("ts", 1)], 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run --project=unit tests/unit/sheet-layout.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/integrations/sheet-layout"`.

- [ ] **Step 3: Implement**

```ts
import "server-only"

/**
 * Where MakingFlow's columns actually are, right now.
 *
 * The sync used to assume the header was row 1 and the Submission ID column A,
 * then write `[id, submittedAt, ...answers]` into A, B, C… Every one of those
 * assumptions is something the sheet's owner can change with two clicks, and
 * when they did, rows silently landed in the wrong columns — or above the
 * header, where the dedup and deletion lookups could no longer see them.
 *
 * So we stop assuming. Each column we own carries a Google Developer Metadata
 * tag, and Sheets moves that tag with the column through inserts, deletes and
 * reorders. This module turns a bag of tags back into "the id is column H, the
 * header is row 5" — pure, so every rule here is testable without a network.
 */

export const TAG_COLUMN = "makingflow.col"
export const TAG_ROW = "makingflow.row"
export const TAG_KEYS = [TAG_COLUMN, TAG_ROW] as const

export const ID_TAG = "id"
export const TIMESTAMP_TAG = "ts"
export const HEADER_TAG = "header"

const FIELD_PREFIX = "f:"

export function fieldTag(fieldId: string): string {
  return `${FIELD_PREFIX}${fieldId}`
}

export function parseFieldTag(value: string): string | null {
  return value.startsWith(FIELD_PREFIX) ? value.slice(FIELD_PREFIX.length) : null
}

export type MetadataTag = {
  key: string
  value: string
  dimension: "ROWS" | "COLUMNS"
  /** 0-based, inclusive. */
  index: number
  sheetId: number
}

export type SheetLayout = {
  sheetId: number
  headerRow: number
  idColumn: number
  timestampColumn: number
  /** fieldId -> 0-based column index. */
  fieldColumns: Map<string, number>
  /** Highest column index we own — appended rows are trimmed here. */
  lastColumn: number
}

/**
 * Leftmost wins. Two deliveries can repair the same sheet concurrently and each
 * create a column for the same field; picking deterministically means both
 * workers agree on where the answer goes, and the stray column is cleaned up on
 * the next reconcile rather than splitting the data.
 */
function claim(into: Map<string, number>, key: string, index: number): void {
  const held = into.get(key)
  if (held === undefined || index < held) into.set(key, index)
}

export function resolveLayout(tags: MetadataTag[], sheetId: number): SheetLayout | null {
  const columns = new Map<string, number>()
  let headerRow: number | null = null

  for (const tag of tags) {
    if (tag.sheetId !== sheetId) continue
    if (tag.key === TAG_ROW && tag.value === HEADER_TAG && tag.dimension === "ROWS") {
      if (headerRow === null || tag.index < headerRow) headerRow = tag.index
      continue
    }
    if (tag.key === TAG_COLUMN && tag.dimension === "COLUMNS") claim(columns, tag.value, tag.index)
  }

  const idColumn = columns.get(ID_TAG)
  const timestampColumn = columns.get(TIMESTAMP_TAG)
  // Without any one of these there is no safe write: no header means we cannot
  // tell data from labels, and no id column means no dedup and no deletion.
  if (headerRow === null || idColumn === undefined || timestampColumn === undefined) return null

  const fieldColumns = new Map<string, number>()
  for (const [value, index] of columns) {
    const fieldId = parseFieldTag(value)
    if (fieldId) fieldColumns.set(fieldId, index)
  }

  const lastColumn = Math.max(idColumn, timestampColumn, ...fieldColumns.values())

  return { sheetId, headerRow, idColumn, timestampColumn, fieldColumns, lastColumn }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest --run --project=unit tests/unit/sheet-layout.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sheet-layout.ts tests/unit/sheet-layout.test.ts
git commit -m "feat(sheets): resolve column and header positions from developer metadata"
```

---

## Task 2: Row building and repair planning (pure)

**Files:**
- Modify: `src/lib/integrations/sheet-layout.ts`
- Test: `tests/unit/sheet-layout.test.ts`

**Interfaces:**
- Consumes: `SheetLayout`, `fieldTag`, `ID_TAG`, `TIMESTAMP_TAG`, `HEADER_TAG`, `TAG_COLUMN`, `TAG_ROW` from Task 1.
- Produces:
  ```ts
  /** null = leave this cell alone. */
  export type Cell = string | null

  export function buildRow(
    layout: SheetLayout,
    values: { submissionId: string; submittedAt: string; byField: Map<string, string> },
  ): Cell[]

  export type RepairPlan = {
    /** fieldId -> the column index it will be created at. */
    create: { fieldId: string; label: string; index: number }[]
    /** Header cells whose text differs from the live field label. */
    relabel: { index: number; label: string }[]
  }

  export function planRepair(
    layout: SheetLayout,
    desired: { fieldId: string; label: string }[],
    headerCells: string[],
  ): RepairPlan
  ```

`buildRow` returns an array indexed by column, `null` for every column MakingFlow does not own, **trimmed at `layout.lastColumn`** so a trailing user column (the right place for an `ARRAYFORMULA`) is never touched.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/sheet-layout.test.ts`:

```ts
import { buildRow, planRepair, type SheetLayout } from "@/lib/integrations/sheet-layout"

/** The layout of a sheet nobody has edited: id, ts, then two questions. */
function pristine(): SheetLayout {
  return {
    sheetId: 0,
    headerRow: 0,
    idColumn: 0,
    timestampColumn: 1,
    fieldColumns: new Map([["f1", 2], ["f2", 3]]),
    lastColumn: 3,
  }
}

describe("buildRow", () => {
  test("places every value at its resolved column", () => {
    const cells = buildRow(pristine(), {
      submissionId: "sub-1",
      submittedAt: "2026-09-22T08:00:00.000Z",
      byField: new Map([["f1", "Ada"], ["f2", "ada@example.test"]]),
    })
    expect(cells).toEqual(["sub-1", "2026-09-22T08:00:00.000Z", "Ada", "ada@example.test"])
  })

  test("writes a field with no answer as an empty cell, not a hole", () => {
    const cells = buildRow(pristine(), {
      submissionId: "sub-1",
      submittedAt: "T",
      byField: new Map([["f2", "only"]]),
    })
    expect(cells).toEqual(["sub-1", "T", "", "only"])
  })

  // The owner inserted a "Notes" column at index 2, pushing our questions right.
  // Their column must come back null so the append leaves it untouched.
  test("leaves a column the owner inserted between ours untouched", () => {
    const layout: SheetLayout = {
      sheetId: 0,
      headerRow: 0,
      idColumn: 0,
      timestampColumn: 1,
      fieldColumns: new Map([["f1", 3], ["f2", 4]]),
      lastColumn: 4,
    }
    const cells = buildRow(layout, {
      submissionId: "sub-1",
      submittedAt: "T",
      byField: new Map([["f1", "Ada"], ["f2", "x"]]),
    })
    expect(cells).toEqual(["sub-1", "T", null, "Ada", "x"])
  })

  // Trailing user columns are where ARRAYFORMULA belongs; trimming is what
  // keeps a spilled formula from being overwritten with a blank.
  test("stops at the last column we own so trailing owner columns survive", () => {
    const cells = buildRow(pristine(), {
      submissionId: "sub-1",
      submittedAt: "T",
      byField: new Map([["f1", "a"], ["f2", "b"]]),
    })
    expect(cells).toHaveLength(4)
  })

  test("handles an owner who moved the id column to the far right", () => {
    const layout: SheetLayout = {
      sheetId: 0,
      headerRow: 0,
      idColumn: 3,
      timestampColumn: 0,
      fieldColumns: new Map([["f1", 1]]),
      lastColumn: 3,
    }
    const cells = buildRow(layout, {
      submissionId: "sub-1",
      submittedAt: "T",
      byField: new Map([["f1", "a"]]),
    })
    expect(cells).toEqual(["T", "a", null, "sub-1"])
  })
})

describe("planRepair", () => {
  test("plans nothing for a sheet that already matches the form", () => {
    const plan = planRepair(
      pristine(),
      [{ fieldId: "f1", label: "Name" }, { fieldId: "f2", label: "Email" }],
      ["Submission ID", "Submitted at", "Name", "Email"],
    )
    expect(plan).toEqual({ create: [], relabel: [] })
  })

  test("appends a newly added question past the last column we own", () => {
    const plan = planRepair(
      pristine(),
      [
        { fieldId: "f1", label: "Name" },
        { fieldId: "f2", label: "Email" },
        { fieldId: "f3", label: "Phone" },
      ],
      ["Submission ID", "Submitted at", "Name", "Email"],
    )
    expect(plan.create).toEqual([{ fieldId: "f3", label: "Phone", index: 4 }])
  })

  test("numbers several new questions consecutively", () => {
    const plan = planRepair(
      pristine(),
      [
        { fieldId: "f1", label: "Name" },
        { fieldId: "f2", label: "Email" },
        { fieldId: "f3", label: "Phone" },
        { fieldId: "f4", label: "City" },
      ],
      ["Submission ID", "Submitted at", "Name", "Email"],
    )
    expect(plan.create.map((c) => c.index)).toEqual([4, 5])
  })

  test("relabels a header the form renamed", () => {
    const plan = planRepair(
      pristine(),
      [{ fieldId: "f1", label: "Full name" }, { fieldId: "f2", label: "Email" }],
      ["Submission ID", "Submitted at", "Name", "Email"],
    )
    expect(plan.relabel).toEqual([{ index: 2, label: "Full name" }])
  })

  // The owner deleted the header text but kept the column. Restoring it is
  // free; leaving it blank makes the sheet unreadable.
  test("restores a header cell the owner blanked", () => {
    const plan = planRepair(
      pristine(),
      [{ fieldId: "f1", label: "Name" }, { fieldId: "f2", label: "Email" }],
      ["Submission ID", "Submitted at", "", "Email"],
    )
    expect(plan.relabel).toEqual([{ index: 2, label: "Name" }])
  })

  // A question removed from the form keeps its column so historic rows still
  // read correctly — this is the one case where we deliberately do nothing.
  test("leaves the column of a deleted question in place", () => {
    const plan = planRepair(
      pristine(),
      [{ fieldId: "f1", label: "Name" }],
      ["Submission ID", "Submitted at", "Name", "Email"],
    )
    expect(plan.create).toEqual([])
    expect(plan.relabel).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run --project=unit tests/unit/sheet-layout.test.ts`
Expected: FAIL — `buildRow is not a function`.

- [ ] **Step 3: Implement** — append to `src/lib/integrations/sheet-layout.ts`

```ts
/** A cell to write, or `null` to leave whatever is there alone. */
export type Cell = string | null

/**
 * One row, laid out by resolved column index rather than field order.
 *
 * Trimmed at `lastColumn` on purpose: anything further right belongs to the
 * sheet's owner, and an appended blank there would overwrite a spilled
 * ARRAYFORMULA with an empty value.
 */
export function buildRow(
  layout: SheetLayout,
  values: { submissionId: string; submittedAt: string; byField: Map<string, string> },
): Cell[] {
  const cells: Cell[] = new Array(layout.lastColumn + 1).fill(null)
  cells[layout.idColumn] = values.submissionId
  cells[layout.timestampColumn] = values.submittedAt
  for (const [fieldId, index] of layout.fieldColumns) {
    cells[index] = values.byField.get(fieldId) ?? ""
  }
  return cells
}

export type RepairPlan = {
  create: { fieldId: string; label: string; index: number }[]
  relabel: { index: number; label: string }[]
}

/**
 * What this sheet needs to match the form: columns for questions added since
 * the last sync, and header text for questions since renamed (or blanked by
 * hand). A question removed from the form keeps its column — historic rows
 * still resolve through it.
 */
export function planRepair(
  layout: SheetLayout,
  desired: { fieldId: string; label: string }[],
  headerCells: string[],
): RepairPlan {
  const create: RepairPlan["create"] = []
  const relabel: RepairPlan["relabel"] = []
  let next = layout.lastColumn + 1

  for (const field of desired) {
    const index = layout.fieldColumns.get(field.fieldId)
    if (index === undefined) {
      create.push({ fieldId: field.fieldId, label: field.label, index: next })
      next += 1
      continue
    }
    if ((headerCells[index] ?? "") !== field.label) relabel.push({ index, label: field.label })
  }

  return { create, relabel }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest --run --project=unit tests/unit/sheet-layout.test.ts`
Expected: PASS, 19 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sheet-layout.ts tests/unit/sheet-layout.test.ts
git commit -m "feat(sheets): build rows and repair plans from a resolved layout"
```

---

## Task 3: Grid-addressed Sheets primitives

**Files:**
- Modify: `src/lib/integrations/google.ts` (add after `deleteRow`, `google.ts:323`)
- Test: `tests/unit/sheets-grid-api.test.ts`

**Interfaces:**
- Consumes: `MetadataTag`, `Cell`, `TAG_KEYS` from Tasks 1-2.
- Produces:
  ```ts
  export async function runBatchUpdate(accessToken: string, spreadsheetId: string, requests: unknown[]): Promise<void>
  export async function searchDeveloperMetadata(accessToken: string, spreadsheetId: string, keys: readonly string[]): Promise<MetadataTag[]>
  export async function appendCells(accessToken: string, spreadsheetId: string, sheetId: number, cells: Cell[]): Promise<void>
  export async function readGridColumn(accessToken: string, spreadsheetId: string, sheetId: number, columnIndex: number): Promise<string[]>
  export function cellData(value: Cell): Record<string, unknown>
  export function tagColumnRequest(sheetId: number, index: number, value: string): unknown
  export function tagRowRequest(sheetId: number, index: number, value: string): unknown
  export function writeCellRequest(sheetId: number, rowIndex: number, columnIndex: number, value: string): unknown
  ```

Key detail: `readGridColumn` uses `values:batchGetByDataFilter` with a `gridRange`, which is index-addressed. **Nothing here takes a sheet name** — that is what makes a renamed tab a non-event.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  appendCells,
  readGridColumn,
  searchDeveloperMetadata,
} from "@/lib/integrations/google"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe("searchDeveloperMetadata", () => {
  test("flattens the matched metadata into tags with their current index", async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        matchedDeveloperMetadata: [
          {
            developerMetadata: {
              metadataKey: "makingflow.col",
              metadataValue: "id",
              location: {
                dimensionRange: { sheetId: 0, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
              },
            },
          },
          {
            developerMetadata: {
              metadataKey: "makingflow.row",
              metadataValue: "header",
              location: {
                dimensionRange: { sheetId: 0, dimension: "ROWS", startIndex: 1, endIndex: 2 },
              },
            },
          },
        ],
      }),
    )

    const tags = await searchDeveloperMetadata("token", "sheet-1", ["makingflow.col", "makingflow.row"])

    expect(tags).toEqual([
      { key: "makingflow.col", value: "id", dimension: "COLUMNS", index: 3, sheetId: 0 },
      { key: "makingflow.row", value: "header", dimension: "ROWS", index: 1, sheetId: 0 },
    ])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/sheet-1/developerMetadata:search")
    expect(JSON.parse(init.body as string)).toEqual({
      dataFilters: [
        { developerMetadataLookup: { metadataKey: "makingflow.col" } },
        { developerMetadataLookup: { metadataKey: "makingflow.row" } },
      ],
    })
  })

  test("is empty for a sheet that has never been tagged", async () => {
    fetchMock.mockReturnValueOnce(ok({}))
    expect(await searchDeveloperMetadata("token", "sheet-1", ["makingflow.col"])).toEqual([])
  })

  // Metadata attached to a whole sheet or spreadsheet has no dimensionRange;
  // treating it as index 0 would silently claim column A.
  test("drops metadata that is not attached to a dimension", async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        matchedDeveloperMetadata: [
          {
            developerMetadata: {
              metadataKey: "makingflow.col",
              metadataValue: "id",
              location: { sheetId: 0 },
            },
          },
        ],
      }),
    )
    expect(await searchDeveloperMetadata("token", "sheet-1", ["makingflow.col"])).toEqual([])
  })
})

describe("appendCells", () => {
  test("appends after the last row with data, addressing the tab by id", async () => {
    fetchMock.mockReturnValueOnce(ok({}))

    await appendCells("token", "sheet-1", 42, ["sub-1", "2026-09-22T08:00:00.000Z", null, "Ada"])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/sheet-1:batchUpdate")
    expect(url).not.toContain("Submissions")
    expect(JSON.parse(init.body as string)).toEqual({
      requests: [
        {
          appendCells: {
            sheetId: 42,
            fields: "userEnteredValue",
            rows: [
              {
                values: [
                  { userEnteredValue: { stringValue: "sub-1" } },
                  { userEnteredValue: { stringValue: "2026-09-22T08:00:00.000Z" } },
                  {},
                  { userEnteredValue: { stringValue: "Ada" } },
                ],
              },
            ],
          },
        },
      ],
    })
  })

  test("sends no request for an empty row", async () => {
    await appendCells("token", "sheet-1", 42, [])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("readGridColumn", () => {
  test("reads one column by index without naming the tab", async () => {
    fetchMock.mockReturnValueOnce(
      ok({ valueRanges: [{ valueRange: { values: [["Submission ID", "sub-1", "sub-2"]] } }] }),
    )

    const values = await readGridColumn("token", "sheet-1", 42, 3)

    expect(values).toEqual(["Submission ID", "sub-1", "sub-2"])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/sheet-1/values:batchGetByDataFilter")
    expect(JSON.parse(init.body as string)).toEqual({
      majorDimension: "COLUMNS",
      dataFilters: [{ gridRange: { sheetId: 42, startColumnIndex: 3, endColumnIndex: 4 } }],
    })
  })

  test("is empty for a column that holds nothing", async () => {
    fetchMock.mockReturnValueOnce(ok({ valueRanges: [{ valueRange: {} }] }))
    expect(await readGridColumn("token", "sheet-1", 42, 3)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run --project=unit tests/unit/sheets-grid-api.test.ts`
Expected: FAIL — `searchDeveloperMetadata is not a function`.

- [ ] **Step 3: Implement** — append to `src/lib/integrations/google.ts`

```ts
/**
 * Grid-addressed Sheets I/O.
 *
 * Everything below targets a tab by its numeric `sheetId` and cells by 0-based
 * index — never by an A1 range like `Submissions!A1`. That is deliberate: the
 * A1 form embeds the tab's NAME, so renaming the tab used to break every write,
 * and `values.append`'s table detection put rows above the header whenever row
 * 1 happened to be blank. Indexes have neither failure mode.
 */

/** Run a batchUpdate (structural edits, metadata, grid writes). */
export async function runBatchUpdate(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<void> {
  await batchUpdate(accessToken, spreadsheetId, requests)
}

/** A CellData that writes `value`, or an empty one that leaves the cell alone. */
export function cellData(value: Cell): Record<string, unknown> {
  return value === null ? {} : { userEnteredValue: { stringValue: value } }
}

function metadataRequest(
  sheetId: number,
  dimension: "ROWS" | "COLUMNS",
  index: number,
  key: string,
  value: string,
): unknown {
  return {
    createDeveloperMetadata: {
      developerMetadata: {
        metadataKey: key,
        metadataValue: value,
        // DOCUMENT rather than PROJECT: it survives a Google Cloud project
        // change, which PROJECT visibility would silently hide from us.
        visibility: "DOCUMENT",
        location: {
          dimensionRange: { sheetId, dimension, startIndex: index, endIndex: index + 1 },
        },
      },
    },
  }
}

export function tagColumnRequest(sheetId: number, index: number, value: string): unknown {
  return metadataRequest(sheetId, "COLUMNS", index, TAG_COLUMN, value)
}

export function tagRowRequest(sheetId: number, index: number, value: string): unknown {
  return metadataRequest(sheetId, "ROWS", index, TAG_ROW, value)
}

/** Write one cell, leaving every other cell in the row untouched. */
export function writeCellRequest(
  sheetId: number,
  rowIndex: number,
  columnIndex: number,
  value: string,
): unknown {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex },
      fields: "userEnteredValue",
      rows: [{ values: [cellData(value)] }],
    },
  }
}

/** Every MakingFlow tag on the spreadsheet, with its CURRENT index. */
export async function searchDeveloperMetadata(
  accessToken: string,
  spreadsheetId: string,
  keys: readonly string[],
): Promise<MetadataTag[]> {
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/developerMetadata:search`,
    {
      method: "POST",
      body: JSON.stringify({
        dataFilters: keys.map((metadataKey) => ({ developerMetadataLookup: { metadataKey } })),
      }),
    },
  )) as {
    matchedDeveloperMetadata?: {
      developerMetadata?: {
        metadataKey?: string
        metadataValue?: string
        location?: {
          dimensionRange?: { sheetId?: number; dimension?: string; startIndex?: number }
        }
      }
    }[]
  }

  const tags: MetadataTag[] = []
  for (const match of data.matchedDeveloperMetadata ?? []) {
    const meta = match.developerMetadata
    const range = meta?.location?.dimensionRange
    // Sheet- or spreadsheet-scoped metadata has no dimensionRange. Defaulting
    // its index to 0 would claim column A for whatever it tagged.
    if (!meta?.metadataKey || meta.metadataValue === undefined) continue
    if (!range || range.sheetId === undefined || range.startIndex === undefined) continue
    if (range.dimension !== "ROWS" && range.dimension !== "COLUMNS") continue
    tags.push({
      key: meta.metadataKey,
      value: meta.metadataValue,
      dimension: range.dimension,
      index: range.startIndex,
      sheetId: range.sheetId,
    })
  }
  return tags
}

/**
 * Append one row after the last row with data IN THE SHEET.
 *
 * `appendCells` is what `values.append` is not: it has no table detection, so a
 * blank row above the header cannot pull the write to the top. It is also a
 * single atomic server-side operation, which matters because deliveries are not
 * serialized per form — two responses to the same form can land at once.
 */
export async function appendCells(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  cells: Cell[],
): Promise<void> {
  if (cells.length === 0) return
  await batchUpdate(accessToken, spreadsheetId, [
    {
      appendCells: {
        sheetId,
        fields: "userEnteredValue",
        rows: [{ values: cells.map(cellData) }],
      },
    },
  ])
}

/** Read one column top-to-bottom (incl. the header) by index, not by name. */
export async function readGridColumn(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  columnIndex: number,
): Promise<string[]> {
  const data = (await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${spreadsheetId}/values:batchGetByDataFilter`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "COLUMNS",
        dataFilters: [
          { gridRange: { sheetId, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 } },
        ],
      }),
    },
  )) as { valueRanges?: { valueRange?: { values?: string[][] } }[] }
  return data.valueRanges?.[0]?.valueRange?.values?.[0] ?? []
}
```

Add to the imports at the top of `google.ts`:

```ts
import { TAG_COLUMN, TAG_ROW, type Cell, type MetadataTag } from "@/lib/integrations/sheet-layout"
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest --run --project=unit tests/unit/sheets-grid-api.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify nothing else broke**

Run: `pnpm vitest --run --project=unit && pnpm typecheck`
Expected: PASS. The existing exports are untouched, so `drive-share.test.ts` and the sheets integration tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/google.ts tests/unit/sheets-grid-api.test.ts
git commit -m "feat(sheets): add grid-addressed metadata, append and read primitives"
```

---

## Task 4: Tag the sheet on creation

**Files:**
- Modify: `src/lib/integrations/sheets-provision.ts` (`createFormSheet`, `:99-121`)
- Test: `tests/integration/sheets-layout-resilience.test.ts` (new)

**Interfaces:**
- Consumes: `tagColumnRequest`, `tagRowRequest`, `writeCellRequest`, `runBatchUpdate` (Task 3); `ID_TAG`, `TIMESTAMP_TAG`, `HEADER_TAG`, `fieldTag` (Task 1).
- Produces: `createFormSheet` unchanged in signature, but a newly provisioned sheet now carries a header-row tag and one column tag per column.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/sheets-layout-resilience.test.ts`. Follow the `vi.mock("@/lib/integrations/google", …)` + top-level `await import(…)` pattern from `sheets-account-switch.test.ts:19-56` exactly. The mock records every `runBatchUpdate` request into a module-level array:

```ts
const batchRequests: { spreadsheetId: string; requests: any[] }[] = []

vi.mock("@/lib/integrations/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/google")>()
  return {
    ...actual,
    isGoogleConfigured: () => true,
    getValidAccessToken: async () => "test-token",
    createSpreadsheet: async () => ({
      spreadsheetId: "sheet-1",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      sheetId: 0,
    }),
    getSheetId: async () => 0,
    runBatchUpdate: async (_t: string, spreadsheetId: string, requests: any[]) => {
      batchRequests.push({ spreadsheetId, requests })
    },
    searchDeveloperMetadata: async () => tags,
    appendCells: async (_t: string, _s: string, sheetId: number, cells: any[]) => {
      appended.push({ sheetId, cells })
    },
    readGridColumn: async () => idColumnValues,
  }
})
```

with `beforeEach` resetting `batchRequests.length = 0`, `appended.length = 0`, `tags = []`, `idColumnValues = []`, `gridRows = []`, `deletedRows.length = 0`.

**Harness the later tasks depend on — build all of it here**, since `vi.mock` factories are hoisted and cannot close over module bindings declared later (the same constraint that put `cacheSpy` on `globalThis`, `tests/helpers/cache-spy.ts:15-17`):

```ts
// Mutable fake-spreadsheet state the mock factory reads.
let tags: MetadataTag[] = []
let idColumnValues: string[] = []
let gridRows: string[][] = []
const batchRequests: { spreadsheetId: string; requests: any[] }[] = []
const appended: { sheetId: number; cells: (string | null)[] }[] = []
const deletedRows: number[] = []

/** A COLUMNS tag as searchDeveloperMetadata would return it. */
const colTag = (value: string, index: number): MetadataTag =>
  ({ key: "makingflow.col", value, dimension: "COLUMNS", index, sheetId: 0 })
/** A ROWS tag as searchDeveloperMetadata would return it. */
const rowTag = (value: string, index: number): MetadataTag =>
  ({ key: "makingflow.row", value, dimension: "ROWS", index, sheetId: 0 })
```

Plus two seed helpers, modelled on `seedSwappedAccount` (`sheets-account-switch.test.ts:68-128`) — module-level `seq` counter, `Date.now()` in the unique slug, `.returning({ id })` on every insert:

- `seed()` — workspace + user + published form + current google connection, **no** `form_integrations` row. Returns `{ userId, workspaceId, formId, connectionId }`.
- `seedWithSheet(opts: { columns: { fieldId: string; label: string }[]; extraField?: { id: string; label: string }; sheetName?: string })` — the same, plus `formFields` rows for each column (and `extraField`, which is deliberately absent from `config.columns` so `planRepair` must create it), a completed `submissions` row, and a `form_integrations` row whose `config` is typed `satisfies GoogleSheetsIntegrationConfig`. Returns `{ …seed(), submissionId }`.
- `content(s, answers: Record<string, string>): DeliveryContent` — builds `{ form, submission: { id: s.submissionId, submittedAt: new Date(…) }, answers: [...] }` matching `submission-content.ts:47-51`.

The mock factory also needs `deleteRow: async (_t, _s, _sheetId, rowIndex) => { deletedRows.push(rowIndex) }` and `readGridRows: async () => gridRows`.

The test for this task:

```ts
test("a newly provisioned sheet is tagged so its layout can be found again", async () => {
  const s = await seed()
  await ensureFormSheet({ id: s.formId, workspaceId: s.workspaceId, title: "Application" })

  const requests = batchRequests.flatMap((b) => b.requests)
  const created = requests
    .filter((r) => r.createDeveloperMetadata)
    .map((r) => r.createDeveloperMetadata.developerMetadata)

  expect(created).toContainEqual(
    expect.objectContaining({ metadataKey: "makingflow.row", metadataValue: "header" }),
  )
  expect(created).toContainEqual(
    expect.objectContaining({ metadataKey: "makingflow.col", metadataValue: "id" }),
  )
  expect(created).toContainEqual(
    expect.objectContaining({ metadataKey: "makingflow.col", metadataValue: "ts" }),
  )
  // One tag per answerable field, none for headings or page breaks.
  expect(created.filter((m) => m.metadataValue.startsWith("f:"))).toHaveLength(2)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:db:up && pnpm vitest --run --project=integration tests/integration/sheets-layout-resilience.test.ts`
Expected: FAIL — no `createDeveloperMetadata` requests recorded.

- [ ] **Step 3: Implement**

Replace the `setHeaderRow` call in `createFormSheet` with a single `runBatchUpdate` that writes the header cells **and** creates all tags in one atomic call. Build the requests as: `writeCellRequest(sheetId, 0, i, label)` for each header cell, then `tagRowRequest(sheetId, 0, HEADER_TAG)`, `tagColumnRequest(sheetId, 0, ID_TAG)`, `tagColumnRequest(sheetId, 1, TIMESTAMP_TAG)`, and `tagColumnRequest(sheetId, 2 + i, fieldTag(c.fieldId))` per column. Keep the returned `GoogleSheetsIntegrationConfig` shape identical — `columns`, `hasIdColumn: true`, `sheetName` and `sheetId` all stay, so nothing downstream changes.

Guard: `createSpreadsheet` can return `sheetId: null`. When it does, fall back to the existing `setHeaderRow` path untagged and `console.warn` — the next reconcile migrates it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest --run --project=integration tests/integration/sheets-layout-resilience.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sheets-provision.ts tests/integration/sheets-layout-resilience.test.ts
git commit -m "feat(sheets): tag columns and the header row when provisioning a sheet"
```

---

## Task 5: Resolve, migrate and repair on reconcile

**Files:**
- Modify: `src/lib/integrations/sheets-provision.ts` (`reconcileFormSheet`, `:130-168`)
- Test: `tests/integration/sheets-layout-resilience.test.ts`

**Interfaces:**
- Consumes: `resolveLayout`, `planRepair`, `TAG_KEYS` (Tasks 1-2); `searchDeveloperMetadata`, `runBatchUpdate`, `readGridColumn` (Task 3).
- Produces:
  ```ts
  export async function reconcileFormSheet(
    conn: WorkspaceConnection,
    config: GoogleSheetsIntegrationConfig,
    formId: string,
  ): Promise<{ config: GoogleSheetsIntegrationConfig; changed: boolean; layout: SheetLayout | null }>
  ```

The added `layout` is what `sync.ts` writes through in Task 6. `layout` is `null` only when the sheet is unusable (no `sheetId` resolvable), in which case the caller falls back to today's positional path so nothing regresses mid-rollout.

`refreshFormSheetHeader` (`sheets-provision.ts:172-179`) destructures `{ config: next }` and is unaffected by the added field — leave it as-is. Its caller `enableFormSheet` (`core/integrations.ts:71-144`) likewise needs no change.

New algorithm:
1. Resolve `sheetId`: `config.sheetId ?? await getSheetId(…)`. Prefer the **stored** id so a renamed tab resolves.
2. `tags = await searchDeveloperMetadata(token, spreadsheetId, TAG_KEYS)`, then `layout = resolveLayout(tags, sheetId)`.
3. `layout === null` → **migrate** (Step 3 below), producing a layout.
4. Read the header row via `readGridRow` at `layout.headerRow`, compute `planRepair(layout, await answerableColumns(formId), headerCells)`.
5. Apply the plan in one `runBatchUpdate`: `writeCellRequest` per created/relabelled header cell, plus `tagColumnRequest` per created column. Then fold the created columns into the returned layout in memory (no second round-trip).
6. Keep writing `config.columns` — it stays the record of column order and labels for provisioning and for the fallback path.

**Migration** (`layout === null`) — for sheets created before this change:
- Read the first 20 rows. Find the header row: the first row containing `ID_HEADER` ("Submission ID"), else the first row containing `TIMESTAMP_HEADER`, else row 0.
- Map `config.columns` onto physical columns by matching that row's cell text to each stored label; unmatched fields are treated as missing and created by `planRepair`.
- Tag everything found, tag the header row, and `console.warn` a one-line summary.

- [ ] **Step 1: Write the failing tests**

```ts
test("an untagged legacy sheet is migrated to tags without moving its data", async () => {
  // A pre-feature sheet: header in row 1, no metadata at all.
  tags = []
  gridRows = [["Submission ID", "Submitted at", "Full name", "Email"]]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }, { fieldId: "f2", label: "Email" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  const created = batchRequests
    .flatMap((b) => b.requests)
    .filter((r) => r.createDeveloperMetadata)
    .map((r) => r.createDeveloperMetadata.developerMetadata)
  expect(created.map((m) => m.metadataValue).sort()).toEqual(["f:f1", "f:f2", "header", "id", "ts"])
  // Nothing was inserted, deleted or shifted.
  expect(batchRequests.flatMap((b) => b.requests).filter((r) => r.insertDimension)).toEqual([])
})

test("a header the owner pushed down is migrated at its real row, not row 1", async () => {
  tags = []
  gridRows = [[], ["Submission ID", "Submitted at", "Full name"]]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  const headerTag = batchRequests
    .flatMap((b) => b.requests)
    .find((r) => r.createDeveloperMetadata?.developerMetadata?.metadataValue === "header")
  expect(headerTag.createDeveloperMetadata.developerMetadata.location.dimensionRange.startIndex).toBe(1)
})

test("a question added to the form gets a column past the last one we own", async () => {
  tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  gridRows = [["Submission ID", "Submitted at", "Full name", "My notes"]]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }], extraField: { id: "f2", label: "Email" } })

  await syncSubmissionToSheets(content(s, { f1: "Ada", f2: "ada@example.test" }))

  // Column 3 is the owner's "My notes" — ours goes to 4, never on top of theirs.
  const tag = batchRequests
    .flatMap((b) => b.requests)
    .find((r) => r.createDeveloperMetadata?.developerMetadata?.metadataValue === "f:f2")
  expect(tag.createDeveloperMetadata.developerMetadata.location.dimensionRange.startIndex).toBe(4)
})

test("a renamed tab is still found, because the id is what we stored", async () => {
  tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }], sheetName: "Renamed by owner" })

  const outcome = await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  expect(outcome.ok).toBe(true)
  expect(appended).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest --run --project=integration tests/integration/sheets-layout-resilience.test.ts`
Expected: FAIL — no metadata requests; `reconcileFormSheet` returns no `layout`.

- [ ] **Step 3: Implement** the algorithm above. Add a `readGridRows(accessToken, spreadsheetId, sheetId, rowCount)` helper to `google.ts` alongside `readGridColumn`, using the same `values:batchGetByDataFilter` shape with `majorDimension: "ROWS"` and a `gridRange` of `{ sheetId, startRowIndex: 0, endRowIndex: rowCount }`. Unit-test it in `tests/unit/sheets-grid-api.test.ts` in the same style as `readGridColumn`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest --run --project=integration tests/integration/sheets-layout-resilience.test.ts && pnpm vitest --run --project=unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/sheets-provision.ts src/lib/integrations/google.ts tests/
git commit -m "feat(sheets): resolve the live layout on reconcile and migrate untagged sheets"
```

---

## Task 6: Write submissions through the layout

**Files:**
- Modify: `src/lib/integrations/sync.ts` — `syncSubmissionToSheets` (`:238-279`), `backfillFormSheet` (`:412-483`), `deleteSubmissionFromSheet` (`:491-520`)
- Test: `tests/integration/sheets-layout-resilience.test.ts`

**Interfaces:**
- Consumes: `reconcileFormSheet` returning `layout` (Task 5); `buildRow` (Task 2); `appendCells`, `readGridColumn` (Task 3).
- Produces: no signature changes. `syncSubmissionToSheets`, `backfillFormSheet` and `deleteSubmissionFromSheet` keep their exact current signatures.

Three replacements, all guarded by `if (layout)` with today's code as the `else` so a sheet that cannot be resolved still delivers:

| Site | Today | Becomes |
|---|---|---|
| `sync.ts:262-267` verify | `getColumnValues(…, "A")` then `.slice(1)` | `readGridColumn(…, layout.idColumn)` then `.slice(layout.headerRow + 1)` |
| `sync.ts:269-278` append | `[id, ts, ...columns]` → `appendRow` | `buildRow(layout, …)` → `appendCells` |
| `sync.ts:512-516` delete | `getColumnValues(…, "A")`, `findIndex((v, i) => i > 0 && …)` | `readGridColumn(…, layout.idColumn)`, `findIndex((v, i) => i > layout.headerRow && …)` |

`backfillFormSheet` maps each pending submission through `buildRow` and appends them with one `appendCells` per row (drop `BACKFILL_CHUNK`, or batch N `appendCells` requests into one `runBatchUpdate` — keep the 500 cap as the batch size).

Also fix the latent bug at `sync.ts:240`: `if (reconciled.changed && row)` never persists the config on the lost-provisioning-race path, where `row` is null but `config` was adopted from the winner. Re-read the winner row id and persist against that instead.

- [ ] **Step 1: Write the failing tests** — the core scenarios, one per thing the owner can do:

```ts
test("a hidden Submission ID column changes nothing — the row still lands complete", async () => {
  // Hiding sets hiddenByUser on the dimension; values are untouched, so the
  // only thing that ever made this look broken was the displaced header.
  tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  expect(appended[0].cells).toEqual([s.submissionId, expect.any(String), "Ada"])
})

test("a column inserted at the very start does not shift the answers", async () => {
  // Owner inserted a column before ours; Sheets moved every tag right by one.
  tags = [rowTag("header", 0), colTag("id", 1), colTag("ts", 2), colTag("f:f1", 3)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  expect(appended[0].cells).toEqual([null, s.submissionId, expect.any(String), "Ada"])
})

test("a column inserted between ours is left untouched on the new row", async () => {
  tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 3)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  expect(appended[0].cells[2]).toBeNull()
})

test("a column added at the end is not overwritten, because the row is trimmed", async () => {
  tags = [rowTag("header", 0), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  // Owner's column 3 is beyond lastColumn, so it is not in the payload at all
  // — which is what lets an ARRAYFORMULA there keep spilling.
  expect(appended[0].cells).toHaveLength(3)
})

// The bug that started this: a blank row above the header pulled appends to
// the top, because values.append does table detection and appendCells does not.
test("a stray row above the header cannot pull the append to the top", async () => {
  tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })

  await syncSubmissionToSheets(content(s, { f1: "Ada" }))

  const requests = batchRequests.flatMap((b) => b.requests)
  expect(requests.some((r) => r.appendCells)).toBe(true)
  expect(requests.some((r) => r.updateCells?.start?.rowIndex === 0)).toBe(false)
})

// With the header on row 2, .slice(1) used to drop a real id from the seen set,
// so a retry appended the row a second time.
test("a retry does not duplicate a row when the header is not on row 1", async () => {
  tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })
  idColumnValues = ["stray-value-in-row-1", "Submission ID", s.submissionId]

  const outcome = await syncSubmissionToSheets(content(s, { f1: "Ada" }), { verifyFirst: true })

  expect(outcome).toEqual({ ok: true })
  expect(appended).toHaveLength(0)
})

test("deleting a submission removes the right row when the header is not on row 1", async () => {
  tags = [rowTag("header", 1), colTag("id", 0), colTag("ts", 1), colTag("f:f1", 2)]
  const s = await seedWithSheet({ columns: [{ fieldId: "f1", label: "Full name" }] })
  idColumnValues = ["stray", "Submission ID", "other-sub", s.submissionId]

  await deleteSubmissionFromSheet({ id: s.formId, workspaceId: s.workspaceId }, s.submissionId)

  expect(deletedRows).toEqual([3])
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest --run --project=integration tests/integration/sheets-layout-resilience.test.ts`
Expected: FAIL — rows are still built positionally and `appendRow` is called instead of `appendCells`.

- [ ] **Step 3: Implement** the three replacements and the `sync.ts:240` fix.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest --run --project=integration tests/integration/sheets-layout-resilience.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify no regression across the whole suite**

Run: `pnpm vitest --run --project=unit && pnpm vitest --run --project=integration && pnpm typecheck && pnpm lint`
Expected: PASS. `sheets-account-switch.test.ts` and `sheets-sharing.test.ts` must be green untouched — if they need edits, the change broke a contract it should not have.

- [ ] **Step 6: Commit**

```bash
git add src/lib/integrations/sync.ts tests/integration/sheets-layout-resilience.test.ts
git commit -m "fix(sheets): append, dedup and delete through the resolved layout"
```

---

## Task 7: Retire the A1 paths

**Files:**
- Modify: `src/lib/integrations/google.ts`, `src/lib/integrations/sheets-provision.ts`, `src/lib/integrations/sync.ts`

- [ ] **Step 1:** Confirm nothing outside tests still calls `appendRow`, `appendRows`, `getColumnValues`, `setHeaderRow`, or `insertColumns`.

Run: `rg -n "appendRows?\(|getColumnValues\(|setHeaderRow\(|insertColumns\(" src/`
Expected: no hits in `src/` outside `google.ts`'s own definitions. Any hit is a site Task 5 or 6 missed — fix it before continuing.

- [ ] **Step 2:** Delete those five functions from `google.ts`, and remove them from the `vi.mock` factories in `sheets-account-switch.test.ts:19-56` and `sheets-sharing.test.ts:21-62`.
- [ ] **Step 3:** Mark `sheetName` in `GoogleSheetsIntegrationConfig` (`schema.ts:344-373`) as retained for display/back-compat only, with a comment saying no read path uses it to address the sheet any more. Do **not** drop the field — old configs carry it and removing it is a migration for no gain.
- [ ] **Step 4:** Run the full suite and typecheck.

Run: `pnpm vitest --run && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations tests/
git commit -m "refactor(sheets): drop the A1-addressed write paths"
```

---

## Verification

**Automated**

```bash
pnpm test:db:up
pnpm vitest --run && pnpm typecheck && pnpm lint
pnpm test:db:down
```

**Against a real spreadsheet** — the scenarios that motivated this. Connect Google on a test workspace, publish a form with 3 questions, submit once, then for each case below submit again and confirm the new row lands at the **bottom** with every answer under its correct header:

1. Hide the Submission ID column.
2. Insert a column before column A.
3. Insert a column between two question columns.
4. Add a column at the far right with `=ARRAYFORMULA(IF(B2:B="","",YEAR(B2:B)))` in its header cell — confirm it auto-fills the new row and is never overwritten.
5. Drag a question column to a different position.
6. Insert a blank row above the header — the row that caused the original bug.
7. Rename the tab from `Submissions` to anything else.
8. Add a 4th question to the form — confirm its column appears to the right of the owner's column from (4), and that (4)'s header survives.
9. Bold the header row and give it a fill colour, then submit — confirm the styling is untouched.
10. Delete a submission in MakingFlow — confirm the correct row disappears.

**Migration check (most important, do it first):** take a spreadsheet created *before* this change, submit, and confirm it is tagged in place — no columns inserted, no rows moved, no data shifted. Verify by diffing the sheet's cell contents before and after.

**Rollback:** every change is additive behind `if (layout)`. Reverting Tasks 5-7 restores the positional path; the tags left in users' sheets are inert and invisible.

---

## Assumptions

Stated because they were decided without you, and each is cheap to change:

1. Append stays at the **bottom** — the correct default, now guaranteed structurally rather than by luck.
2. A sheet damaged past repair **self-heals and keeps delivering**, warning to the server log rather than surfacing in the UI. If you want a visible warning on the form's integrations card, that is a follow-up (a status field on the config plus a line in `sync-integration-card.tsx`).
3. Notion sync is **out of scope**.
4. Historical rows in a re-created column stay blank — that data was in the deleted cells.
5. A user column placed **between** MakingFlow columns gets an empty value on each new row, so formulas belong to the **right** of all MakingFlow columns.
