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

/**
 * Responses one CALL will carry. Not a ceiling on the form: a caller that gets
 * a `nextPage` back is expected to come round again, which is how a form with
 * 3,000 responses imports without any single request having to finish it.
 */
export const MAX_API_SUBMISSIONS = 1000
const MAX_SUBMISSION_PAGES = 4

/**
 * Tally allows 100 requests a minute per key. A 68-form account needs more than
 * that, so requests are spaced instead of raced — an import that takes ninety
 * seconds and finishes beats one that takes forty and fails at form fifty.
 *
 * The spacing is per server instance. Under concurrency that is a floor rather
 * than a guarantee, which is what the 429 retry below is for.
 */
// Waiting is the behaviour under test everywhere except in the tests themselves,
// where a real 15-second backoff would turn the suite into a coffee break. The
// ORDER and the retry COUNT still hold under test; only the sleeping is skipped.
const PACED = process.env.NODE_ENV !== "test"
const MIN_INTERVAL_MS = PACED ? 700 : 0
const RETRY_DELAYS_MS = PACED ? [5_000, 15_000] : [0, 0]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

/** Run `task` after the last one, never sooner than MIN_INTERVAL_MS after it. */
function paced<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const gap = MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
    if (gap > 0) await wait(gap)
    lastRequestAt = Date.now()
    return task()
  })
  // Swallow rejections on the CHAIN only — the caller still sees them through
  // `next`. Without this one failure would stall everything queued behind it.
  queue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

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

  for (let attempt = 0; ; attempt += 1) {
    let res: Response
    try {
      res = await paced(() =>
        fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      )
    } catch {
      throw new TallyImportError("UNREACHABLE", TALLY_ERROR_MESSAGES.UNREACHABLE)
    }

    // Being told to slow down is not a failure until we've actually slowed down.
    if (res.status === 429 && attempt < RETRY_DELAYS_MS.length) {
      await wait(retryAfterMs(res) ?? RETRY_DELAYS_MS[attempt])
      continue
    }
    if (!res.ok) throw statusError(res.status)

    try {
      return (await res.json()) as T
    } catch {
      throw new TallyImportError("UNREACHABLE", TALLY_ERROR_MESSAGES.UNREACHABLE)
    }
  }
}

/** Honour `Retry-After` when Tally sends one, rather than guessing. */
function retryAfterMs(res: Response): number | undefined {
  const header = res.headers?.get?.("retry-after")
  if (!header) return undefined
  const seconds = Number(header)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.min(seconds, 60) * 1000
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
  /** Tally's own grouping. Becomes a folder here — see importTallyFormFromApiKey. */
  workspaceId: string | null
  workspaceName: string | null
}

/**
 * Where a Tally account keeps its forms.
 *
 * Workspaces, not folders. Tally has both — workspaces contain nestable folders
 * — but the folder layer is optional and, on a real account, usually empty: the
 * workspace name is what carries the meaning ("SENIOR", "INTERNSHIP", "HR").
 * We fold both into our single flat folder list, preferring the folder name
 * when there is one.
 */
export async function listTallyWorkspaces(apiKey: string): Promise<Map<string, string>> {
  const key = requireKey(apiKey)
  const names = new Map<string, string>()

  // No `limit` here. Unlike /forms, this endpoint rejects it outright —
  // `{"message":"\"limit\" is not allowed","errorType":"VALIDATION"}` — and the
  // 400 was being swallowed by the caller's catch, so every form silently came
  // back with no workspace name and nothing was ever filed into a folder.
  const data = await tallyGet<{ items?: unknown }>(key, "/workspaces")
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const ws = raw as Record<string, unknown>
    if (typeof ws.id !== "string") continue
    if (typeof ws.name === "string" && ws.name.trim()) names.set(ws.id, ws.name.trim())
    // Folders live inside the workspace and are keyed the same way downstream.
    for (const rawFolder of Array.isArray(ws.folders) ? ws.folders : []) {
      const folder = rawFolder as Record<string, unknown>
      if (typeof folder.id === "string" && typeof folder.name === "string" && folder.name.trim()) {
        names.set(folder.id, folder.name.trim())
      }
    }
  }
  return names
}

/** Every form the key can see, across all its workspaces. */
export async function listTallyForms(apiKey: string): Promise<TallyFormSummary[]> {
  const key = requireKey(apiKey)

  // Names first, so each form arrives already knowing what to be filed under.
  let names = new Map<string, string>()
  try {
    names = await listTallyWorkspaces(key)
  } catch (err) {
    // A key that can't read workspaces shouldn't cost the user their form list;
    // they just lose the folder names. But it must not fail SILENTLY — this
    // catch once hid a bad request for an entire migration, and the only
    // symptom was that no folders appeared.
    console.warn(
      "[tally] could not read workspaces; forms will import unfiled:",
      err instanceof TallyImportError ? err.code : "unknown",
    )
  }

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
      // A form filed in a folder belongs under the folder; otherwise under its
      // workspace.
      const groupId =
        (typeof form.folderId === "string" ? form.folderId : null) ??
        (typeof form.workspaceId === "string" ? form.workspaceId : null)
      out.push({
        id: form.id,
        name:
          typeof form.name === "string" && form.name.trim() ? form.name.trim() : "Untitled form",
        status: typeof form.status === "string" ? form.status : "",
        isClosed: form.isClosed === true,
        submissionCount:
          typeof form.numberOfSubmissions === "number" ? form.numberOfSubmissions : 0,
        workspaceId: groupId,
        workspaceName: groupId ? (names.get(groupId) ?? null) : null,
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
    formId,
  )
  return {
    ...parsed,
    // Merge, do not replace: the parser already put the thank-you page into
    // settings, and form-level settings come from a different part of the payload.
    form: {
      ...parsed.form,
      settings: { ...parsed.form.settings, ...parseTallySettings(data.settings) },
    },
  }
}

// ── Submissions ─────────────────────────────────────────────────────────────

/** A question as the submissions endpoint describes it. */
export type TallyApiQuestion = {
  id?: unknown
  title?: unknown
  /** Removed from the form in Tally; its blocks no longer exist. */
  isDeleted?: unknown
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
  /** The page to ask for next, or null when the form is fully read. */
  nextPage: number | null
}

/**
 * A form's completed responses, up to `max`.
 *
 * Completed only, matching what the CSV export contains and what the Submissions
 * tab shows — so importing by key and importing by CSV produce the same thing.
 * Partial responses are a separate feature (they drive drop-off analytics) and
 * mixing them into someone's first migration would misreport their history.
 *
 * Reads from `startPage` and stops when it has `max` rows or runs out, handing
 * back the page to resume from. That is what lets a form with thousands of
 * responses import at all: each call finishes inside the route's time budget,
 * and the caller comes round again rather than one request trying to do it all.
 *
 * Paginated by page number rather than the `afterId` cursor. Page numbering can
 * repeat or skip a row if the form is submitted mid-import, which sounds worse
 * than it is: every row carries Tally's submission id and the caller deduplicates
 * on it, so a repeat is dropped and the next run collects anything missed.
 */
export async function fetchTallySubmissions(
  apiKey: string,
  formId: string,
  options: { startPage?: number; max?: number } = {},
): Promise<TallySubmissionPage> {
  const key = requireKey(apiKey)
  const startPage = Math.max(1, options.startPage ?? 1)
  const max = options.max ?? MAX_API_SUBMISSIONS

  const questions: TallyApiQuestion[] = []
  const submissions: TallyApiSubmission[] = []
  let page = startPage
  let hasMore = false

  for (let read = 0; read < MAX_SUBMISSION_PAGES; read += 1) {
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
    hasMore = data.hasMore === true && batch.length > 0
    page += 1

    if (!hasMore || submissions.length >= max) break
  }

  return { questions, submissions, nextPage: hasMore ? page : null }
}
