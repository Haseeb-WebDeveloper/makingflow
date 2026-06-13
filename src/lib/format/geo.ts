/** Regional-indicator flag emoji for a 2-letter ISO country code. */
export function countryFlag(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return "🏳️"
  return cc
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

let regionNames: Intl.DisplayNames | null = null

/** Human country name for an ISO code (e.g. "US" → "United States"). */
export function countryName(cc: string): string {
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(["en"], { type: "region" })
    return regionNames.of(cc.toUpperCase()) ?? cc
  } catch {
    return cc
  }
}
