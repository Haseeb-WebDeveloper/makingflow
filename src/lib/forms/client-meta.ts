/**
 * Browser-only helpers shared by both respondent runtimes (classic +
 * conversational). Functions only ever run client-side (they read
 * window/document), so this stays a plain module — no "use client" needed.
 */

/** Original referrer + UTM/query params, read from the browser at submit time. */
export function collectClientMeta(): {
  referrer?: string
  urlParams?: Record<string, string>
} {
  if (typeof window === "undefined") return {}
  const referrer = document.referrer || undefined
  const urlParams: Record<string, string> = {}
  try {
    const params = new URLSearchParams(window.location.search)
    for (const [k, v] of params) {
      if (/^(utm_|ref$|gclid$|fbclid$|source$)/i.test(k) && v) urlParams[k] = v.slice(0, 200)
    }
  } catch {
    /* ignore */
  }
  return {
    referrer,
    urlParams: Object.keys(urlParams).length > 0 ? urlParams : undefined,
  }
}

// ── Save & resume token ─────────────────────────────────────────────────────

/**
 * How long an unfinished draft stays offerable.
 *
 * The token is keyed by FORM, not by person — localStorage has no notion of who
 * is sitting at the browser. On a shared or kiosk device that meant respondent
 * two silently inherited respondent one's abandoned answers. Two things fix
 * that: drafts go stale (below), and the runtimes now ASK before restoring
 * rather than applying the answers on load.
 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export type DraftToken = { id: string; savedAt: number }

const draftKey = (publicId: string) => `mf:resume:${publicId}`

/**
 * The stored draft token for a form, or null when there is none, it's
 * unreadable, or it has aged out (in which case it's also cleared).
 *
 * Tolerates the old bare-string format written before drafts carried a
 * timestamp: those are treated as expired, so anyone mid-fill across the deploy
 * simply starts fresh rather than seeing a crash or a stale restore.
 */
export function readDraftToken(publicId: string): DraftToken | null {
  if (typeof window === "undefined") return null
  let raw: string | null = null
  try {
    raw = localStorage.getItem(draftKey(publicId))
  } catch {
    return null // storage blocked
  }
  if (!raw) return null

  let token: DraftToken | null = null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.id === "string" && typeof parsed.savedAt === "number") {
      token = parsed as DraftToken
    }
  } catch {
    /* legacy bare id, or corrupt — falls through to the clear below */
  }

  if (!token || Date.now() - token.savedAt > DRAFT_TTL_MS) {
    clearDraftToken(publicId)
    return null
  }
  return token
}

export function writeDraftToken(publicId: string, id: string): void {
  try {
    localStorage.setItem(draftKey(publicId), JSON.stringify({ id, savedAt: Date.now() }))
  } catch {
    /* storage blocked */
  }
}

export function clearDraftToken(publicId: string): void {
  try {
    localStorage.removeItem(draftKey(publicId))
  } catch {
    /* storage blocked */
  }
}

/** Fire-and-forget funnel beacon — never blocks or surfaces errors. */
export function track(publicId: string, type: "view" | "start") {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicId, type }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}
