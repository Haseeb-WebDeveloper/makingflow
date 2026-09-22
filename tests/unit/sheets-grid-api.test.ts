/**
 * The Sheets calls that never name the tab.
 *
 * Every Sheets request used to be built as `Submissions!A1` — a range that
 * embeds the tab's NAME, captured once at provisioning time. Renaming the tab
 * broke every write from then on, and `values.append`'s table detection put new
 * rows ABOVE the header whenever row 1 happened to be blank.
 *
 * The calls below address a tab by its numeric id and cells by 0-based index,
 * so neither failure has anywhere to happen. These tests exist to keep it that
 * way: they assert on the exact wire format, including that no tab name appears
 * in the URL.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  appendCells,
  readGridColumn,
  readGridRows,
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

    const tags = await searchDeveloperMetadata("token", "sheet-1", [
      "makingflow.col",
      "makingflow.row",
    ])

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

describe("readGridRows", () => {
  test("reads the top rows by index so a displaced header can be found", async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        valueRanges: [
          { valueRange: { values: [[], ["Submission ID", "Submitted at", "Full name"]] } },
        ],
      }),
    )

    const rows = await readGridRows("token", "sheet-1", 42, 20)

    expect(rows).toEqual([[], ["Submission ID", "Submitted at", "Full name"]])
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      majorDimension: "ROWS",
      dataFilters: [{ gridRange: { sheetId: 42, startRowIndex: 0, endRowIndex: 20 } }],
    })
  })

  test("is empty for a sheet with nothing in it", async () => {
    fetchMock.mockReturnValueOnce(ok({ valueRanges: [{ valueRange: {} }] }))
    expect(await readGridRows("token", "sheet-1", 42, 20)).toEqual([])
  })
})
