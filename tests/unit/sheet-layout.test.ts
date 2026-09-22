/**
 * The rules that decide WHERE a submission's cells go.
 *
 * The sync used to assume the header was row 1 and the Submission ID column A,
 * then write every answer from column A in stored order. Each of those is
 * something a spreadsheet's owner changes without thinking — hiding a column,
 * dragging one, inserting a row above the header to give it a title — and each
 * time they did, rows landed under the wrong labels or above the header, where
 * the dedup and deletion lookups could no longer see them.
 *
 * So positions are resolved from developer metadata now instead of assumed, and
 * this file is where that resolution is pinned down. Every case below is a real
 * edit somebody made to a real sheet.
 */

import { describe, expect, test } from "vitest"
import {
  buildRow,
  fieldTag,
  parseFieldTag,
  planRepair,
  resolveLayout,
  type MetadataTag,
  type SheetLayout,
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
      fieldColumns: new Map([
        ["f1", 2],
        ["f2", 3],
      ]),
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

/** The layout of a sheet nobody has edited: id, ts, then two questions. */
function pristine(): SheetLayout {
  return {
    sheetId: 0,
    headerRow: 0,
    idColumn: 0,
    timestampColumn: 1,
    fieldColumns: new Map([
      ["f1", 2],
      ["f2", 3],
    ]),
    lastColumn: 3,
  }
}

describe("buildRow", () => {
  test("places every value at its resolved column", () => {
    const cells = buildRow(pristine(), {
      submissionId: "sub-1",
      submittedAt: "2026-09-22T08:00:00.000Z",
      byField: new Map([
        ["f1", "Ada"],
        ["f2", "ada@example.test"],
      ]),
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
      fieldColumns: new Map([
        ["f1", 3],
        ["f2", 4],
      ]),
      lastColumn: 4,
    }
    const cells = buildRow(layout, {
      submissionId: "sub-1",
      submittedAt: "T",
      byField: new Map([
        ["f1", "Ada"],
        ["f2", "x"],
      ]),
    })
    expect(cells).toEqual(["sub-1", "T", null, "Ada", "x"])
  })

  // Trailing user columns are where ARRAYFORMULA belongs; trimming is what
  // keeps a spilled formula from being overwritten with a blank.
  test("stops at the last column we own so trailing owner columns survive", () => {
    const cells = buildRow(pristine(), {
      submissionId: "sub-1",
      submittedAt: "T",
      byField: new Map([
        ["f1", "a"],
        ["f2", "b"],
      ]),
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
      [
        { fieldId: "f1", label: "Name" },
        { fieldId: "f2", label: "Email" },
      ],
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
      [
        { fieldId: "f1", label: "Full name" },
        { fieldId: "f2", label: "Email" },
      ],
      ["Submission ID", "Submitted at", "Name", "Email"],
    )
    expect(plan.relabel).toEqual([{ index: 2, label: "Full name" }])
  })

  // The owner deleted the header text but kept the column. Restoring it is
  // free; leaving it blank makes the sheet unreadable.
  test("restores a header cell the owner blanked", () => {
    const plan = planRepair(
      pristine(),
      [
        { fieldId: "f1", label: "Name" },
        { fieldId: "f2", label: "Email" },
      ],
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
