import type { AnswerValue } from "@/lib/db/schema"

export type AnswerFile = { name: string; url: string }

/**
 * Files attached to a file-upload / signature answer, or null if the value
 * isn't that shape. The stored value is `{ files: [{ name, url, ... }] }`.
 */
export function answerFiles(value: AnswerValue | undefined): AnswerFile[] | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null
  const files = (value as { files?: unknown }).files
  if (!Array.isArray(files)) return null
  const out: AnswerFile[] = []
  for (const f of files) {
    if (f && typeof f === "object") {
      const r = f as Record<string, unknown>
      out.push({ name: r.name ? String(r.name) : "file", url: r.url ? String(r.url) : "" })
    }
  }
  return out.length ? out : null
}

/**
 * Render any answer value as a single plain-text cell. Files become
 * "name (url)" so integrations never leak the raw JSON blob. Scalars/arrays
 * keep the same output the integrations produced before.
 */
export function answerToCell(value: AnswerValue | undefined): string {
  if (value == null) return ""
  const files = answerFiles(value)
  if (files) return files.map((f) => (f.url ? `${f.name} (${f.url})` : f.name)).join(", ")
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
