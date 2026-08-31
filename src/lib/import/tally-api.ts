import "server-only"

import {
  parseTallyBlocks,
  parseTallySettings,
  type TallyBlock,
  type TallyParseResult,
} from "@/lib/import/tally-blocks"
import { TALLY_ERROR_MESSAGES, TallyImportError, type TallyFetchError } from "@/lib/import/tally-error"

/**
 * Reading Tally with the owner's API key.
 *
 * The second source into the same parser. Where the public-page reader
 * (./tally-page.ts) scrapes what a respondent can see, this asks Tally
 * directly — which is what unlocks the three things a share link cannot give:
 *
 *   - forms that are private, unpublished or password-protected
 *   - every form in the account at once, rather than one pasted link at a time
 *   - the RESPONSES, without the CSV round-trip
 *
 * The third is the one that matters most. `GET /forms/{id}/submissions` returns
 * a `questions[]` array alongside the answers, and each question carries the
 * `blockGroupUuid` of the blocks it came from — so answers join to questions by
 * identity. The CSV path can only join on the header text, which quietly stops
 * matching the moment someone edits a question label after collecting replies.
 *
 * Verified against Tally's published API reference (August 2026): base
 * `https://api.tally.so`, bearer auth, 100 requests a minute, `limit` capped at
 * 500 on both list endpoints.
 */

const TALLY_API = "https://api.tally.so"
const TIMEOUT_MS = 20_000

/** The documented maximum for both list endpoints. */
const PAGE_SIZE = 500

/** 5,000 forms is far past any real account; a loop needs a ceiling regardless. */
const MAX_FORM_PAGES = 10

/** Matches the CSV path's per-import ceiling, so both sources behave alike. */
export const MAX_API_SUBMISSIONS = 2000
const MAX_SUBMISSION_PAGES = 6

/**
 * Every request this module makes.
 *
 * GET is hard-coded rather than passed in, and that is a security decision, not
 * a style one: a Tally API key is UNSCOPED. The same token that lists forms can
 * DELETE forms and their responses. A migration tool has no business issuing
 * anything but reads, so this file gives itself no way to express a write.
 *
 * Nothing here logs. The key is a bearer credential we hold only for the length
 * of one request, and the surest way not to leak it into a log aggregator is to
 * have no log line it could ever reach.
 */
async function tallyGet<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(path, TALLY_API)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new TallyImportError("UNREACHABLE", TALLY_ERROR_MESSAGES.UNREACHABLE)
  }

  if (!res.ok) throw statusError(res.status)

  try {
    return (await res.json()) as T
  } catch {
    throw new TallyImportError("UNREACHABLE", TALLY_ERROR_MESSAGES.UNREACHABLE)
  }
}

/** Tally's HTTP status → the reason we show the user. */
function statusError(status: number): TallyImportError {
  const code: TallyFetchError =
    status === 401
      ? "INVALID_KEY"
      : status === 403
        ? "FORBIDDEN"
        : status === 404
          ? "NOT_FOUND"
          : status === 429
            ? "RATE_LIMITED"
            : "UNREACHABLE"
  return new TallyImportError(code, TALLY_ERROR_MESSAGES[code])
}

/**
 * Reject junk before spending a request on it.
 *
 * Deliberately loose — Tally has never documented a key format, so anything
 * stricter would break the day they change it. This only catches what could
 * never be a key: something empty, absurdly long, or containing the whitespace
 * and control characters that have no place in an HTTP header value.
 */
export function isPlausibleApiKey(key: string): boolean {
  return /^[\x21-\x7e]{16,300}$/.test(key.trim())
}

function requireKey(apiKey: string): string {
  const key = apiKey.trim()
  if (!isPlausibleApiKey(key)) {
    throw new TallyImportError("INVALID_KEY", TALLY_ERROR_MESSAGES.INVALID_KEY)
  }
  return key
}

// ── Forms ───────────────────────────────────────────────────────────────────

export type TallyFormSummary = {
  id: string
  name: string
  status: string
  isClosed: boolean
  submissionCount: number
}

/** Every form the key can see, newest page first, across all its workspaces. */
export async function listTallyForms(apiKey: string): Promise<TallyFormSummary[]> {
  const key = requireKey(apiKey)
  const out: TallyFormSummary[] = []

  for (let page = 1; page <= MAX_FORM_PAGES; page += 1) {
    const data = await tallyGet<{ items?: unknown; hasMore?: unknown }>(key, "/forms", {
      page,
      limit: PAGE_SIZE,
    })
    const items = Array.isArray(data.items) ? data.items : []

    for (const raw of items) {
      const form = raw as Record<string, unknown>
      if (typeof form.id !== "string") continue
      out.push({
        id: form.id,
        name:
          typeof form.name === "string" && form.name.trim() ? form.name.trim() : "Untitled form",
        status: typeof form.status === "string" ? form.status : "",
        isClosed: form.isClosed === true,
        submissionCount:
          typeof form.numberOfSubmissions === "number" ? form.numberOfSubmissions : 0,
      })
    }

    if (data.hasMore !== true || items.length === 0) break
  }

  return out
}

/**
 * One form's definition.
 *
 * `GET /forms/{id}` returns the same flat block array the public page embeds,
 * so this hands straight to the shared parser — the whole reason the parser was
 * written to take blocks and nothing else.
 */
export async function fetchTallyFormFromApi(
  apiKey: string,
  formId: string,
): Promise<TallyParseResult> {
  const key = requireKey(apiKey)
  const data = await tallyGet<{ name?: unknown; blocks?: unknown; settings?: unknown }>(
    key,
    `/forms/${encodeURIComponent(formId)}`,
  )

  if (!Array.isArray(data.blocks)) {
    throw new TallyImportError("NO_DEFINITION", TALLY_ERROR_MESSAGES.NO_DEFINITION)
  }

  const parsed = parseTallyBlocks(
    data.blocks as TallyBlock[],
    typeof data.name === "string" ? data.name : undefined,
  )
  return {
    ...parsed,
    form: { ...parsed.form, settings: parseTallySettings(data.settings) },
  }
}

// ── Submissions ─────────────────────────────────────────────────────────────

/** A question as the submissions endpoint describes it. */
export type TallyApiQuestion = {
  id?: unknown
  title?: unknown
  /** The blocks this question was built from — the link back to our fields. */
  fields?: unknown
}

export type TallyApiResponse = {
  questionId?: unknown
  answer?: unknown
  formattedAnswer?: unknown
}

export type TallyApiSubmission = {
  id?: unknown
  isCompleted?: unknown
  submittedAt?: unknown
  responses?: unknown
}

export type TallySubmissionPage = {
  questions: TallyApiQuestion[]
  submissions: TallyApiSubmission[]
  /** True when the form has more responses than one import will carry. */
  truncated: boolean
}

/**
 * A form's completed responses, up to `max`.
 *
 * Completed only, matching what the CSV export contains and what the Submissions
 * tab shows — so importing by key and importing by CSV produce the same thing.
 * Partial responses are a separate feature (they drive drop-off analytics) and
 * mixing them into someone's first migration would misreport their history.
 *
 * Paginated by page number rather than the `afterId` cursor. Page numbering can
 * repeat or skip a row if the form is submitted mid-import, which sounds worse
 * than it is: every row carries Tally's submission id and the caller deduplicates
 * on it, so a repeat is dropped and the next run collects anything missed.
 */
export async function fetchTallySubmissions(
  apiKey: string,
  formId: string,
  max: number = MAX_API_SUBMISSIONS,
): Promise<TallySubmissionPage> {
  const key = requireKey(apiKey)
  const questions: TallyApiQuestion[] = []
  const submissions: TallyApiSubmission[] = []
  let hasMore = false

  for (let page = 1; page <= MAX_SUBMISSION_PAGES; page += 1) {
    const data = await tallyGet<{
      questions?: unknown
      submissions?: unknown
      hasMore?: unknown
    }>(key, `/forms/${encodeURIComponent(formId)}/submissions`, {
      page,
      limit: PAGE_SIZE,
      filter: "completed",
    })

    // The question list is repeated on every page; the first one is enough.
    if (questions.length === 0 && Array.isArray(data.questions)) {
      questions.push(...(data.questions as TallyApiQuestion[]))
    }

    const batch = Array.isArray(data.submissions) ? (data.submissions as TallyApiSubmission[]) : []
    submissions.push(...batch)
    hasMore = data.hasMore === true

    if (!hasMore || batch.length === 0 || submissions.length >= max) break
  }

  return {
    questions,
    submissions: submissions.slice(0, max),
    truncated: hasMore || submissions.length > max,
  }
}
