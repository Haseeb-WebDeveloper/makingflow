/**
 * Submission exports carry text written by anonymous respondents, and the form
 * owner opens that file in a spreadsheet. Quoting alone doesn't stop a leading
 * `=` from being evaluated on open, so the export used to hand the owner live
 * formulas written by strangers.
 */
import { describe, expect, test } from "vitest"
import { escapeCsvCell, csvRow, neutralizeFormula, csvFileName } from "@/lib/submissions/csv"

describe("neutralizeFormula", () => {
  test("prefixes the characters spreadsheets treat as formulas", () => {
    expect(neutralizeFormula('=HYPERLINK("http://x","x")')).toBe(
      '\'=HYPERLINK("http://x","x")',
    )
    expect(neutralizeFormula("+1")).toBe("'+1")
    expect(neutralizeFormula("-1")).toBe("'-1")
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(neutralizeFormula("\tx")).toBe("'\tx")
  })

  test("leaves ordinary text and URLs alone", () => {
    expect(neutralizeFormula("Chartreuse")).toBe("Chartreuse")
    expect(neutralizeFormula("")).toBe("")
    // Sheets writes with USER_ENTERED so file links stay clickable — a URL must
    // pass through untouched.
    expect(neutralizeFormula("https://res.cloudinary.com/x/cv.pdf")).toBe(
      "https://res.cloudinary.com/x/cv.pdf",
    )
    // Only the LEADING character matters.
    expect(neutralizeFormula("2+2")).toBe("2+2")
  })
})

describe("escapeCsvCell", () => {
  test("quotes and doubles inner quotes", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell("a,b")).toBe('"a,b"')
    expect(escapeCsvCell("line\nbreak")).toBe('"line\nbreak"')
  })

  test("neutralizes formulas inside the quotes", () => {
    expect(escapeCsvCell("=1+1")).toBe(`"'=1+1"`)
  })

  test("renders nullish as an empty cell", () => {
    expect(escapeCsvCell(null)).toBe('""')
    expect(escapeCsvCell(undefined)).toBe('""')
  })
})

describe("csvRow", () => {
  test("joins escaped cells", () => {
    expect(csvRow(["Submitted", "Name", "=cmd"])).toBe(`"Submitted","Name","'=cmd"`)
  })
})

describe("csvFileName", () => {
  test("slugifies the form title", () => {
    expect(csvFileName("Job Application 2026")).toBe("job-application-2026-submissions.csv")
  })

  test("falls back when the title has nothing usable", () => {
    expect(csvFileName("///")).toBe("form-submissions.csv")
    expect(csvFileName("")).toBe("form-submissions.csv")
  })
})
