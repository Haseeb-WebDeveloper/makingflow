/**
 * CSV serialization for submission exports, plus the shared formula guard.
 *
 * Everything written here originated with an anonymous respondent, so it has to
 * be inert when the form owner opens it in Excel, Numbers or Sheets — those
 * treat a leading `=`, `+`, `-` or `@` as the start of a formula, which turns a
 * free-text answer into code that runs against the owner's data.
 */

/** Characters that make a spreadsheet read the cell as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

/**
 * Make one cell literal text for a spreadsheet.
 *
 * A leading apostrophe is the conventional escape: spreadsheets strip it on
 * display and treat the rest as text, so the owner sees exactly what the
 * respondent typed. URLs are unaffected (they start with a scheme, never with
 * a formula character), which is what keeps file links clickable in the Google
 * Sheets sync — that writes with `valueInputOption=USER_ENTERED` deliberately.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

/**
 * Quote one value for CSV and neutralize spreadsheet formula injection.
 * Quoting alone is not enough — `"=HYPERLINK(...)"` is still evaluated on open.
 */
export function escapeCsvCell(value: unknown): string {
  const s = value == null ? "" : String(value)
  return `"${neutralizeFormula(s).replace(/"/g, '""')}"`
}

/** Join one record into a CSV line. */
export function csvRow(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(",")
}

/** A filesystem-safe download name for a form's export. */
export function csvFileName(formTitle: string): string {
  const slug = formTitle.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()
  return `${slug || "form"}-submissions.csv`
}
