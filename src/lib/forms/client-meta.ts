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
