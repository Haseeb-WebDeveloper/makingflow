import type { AnswerValue } from "@/lib/db/schema"

/**
 * Server-side ceilings on what a respondent may store, shared by BOTH write
 * paths: the final submit (`submitForm`) and the partial-draft autosave
 * (`/api/partial`).
 *
 * They used to live only in the action, which left the partial route — the
 * unauthenticated endpoint the runtime hits every 1.2s of typing — accepting an
 * unbounded number of answers of unbounded size. Anything that writes to
 * `answers` on behalf of an anonymous respondent imports these.
 */

/** Most answers one submission (or draft) may carry. */
export const MAX_ANSWERS = 1000

/** Longest single answer value. */
export const MAX_VALUE_LEN = 50_000

/**
 * Size of one answer value, in characters of what we'd actually store.
 *
 * The object branch matters: file_upload / signature values are objects
 * (`{ files: [...] }`), and under `String()` every one of them measured
 * "[object Object]".length === 15 — so no object payload could ever exceed
 * MAX_VALUE_LEN however large it really was.
 */
export function valueLength(v: AnswerValue | undefined): number {
  if (typeof v === "string") return v.length
  if (Array.isArray(v)) return v.reduce((n, x) => n + String(x).length, 0)
  if (v !== null && typeof v === "object") {
    try {
      return JSON.stringify(v).length
    } catch {
      return MAX_VALUE_LEN + 1 // unserializable — treat as over the limit
    }
  }
  return String(v ?? "").length
}
