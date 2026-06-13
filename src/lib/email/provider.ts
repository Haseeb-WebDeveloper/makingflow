import "server-only"

/**
 * Transactional email via Resend's REST API (no SDK dependency). One thin
 * `sendEmail` behind which the provider could be swapped. Server-only.
 *
 * Env: RESEND_API_KEY + EMAIL_FROM (e.g. "MakingFlow <notify@yourdomain.com>" —
 * the domain must be verified in Resend).
 */

const RESEND_URL = "https://api.resend.com/emails"

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

export async function sendEmail(opts: {
  to: string[]
  subject: string
  html: string
  replyTo?: string
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) return { ok: false, error: "Email is not configured" }
  if (opts.to.length === 0) return { ok: false, error: "No recipients" }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        reply_to: opts.replyTo,
      }),
    })
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
