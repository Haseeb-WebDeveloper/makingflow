import "server-only"
import { createHash } from "node:crypto"
import { headers } from "next/headers"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { forms, formEvents } from "@/lib/db/schema"
import { clientIp } from "@/lib/rate-limit"

const SALT = process.env.ANALYTICS_SALT ?? "makingflow-analytics"

/**
 * Anonymous, salted daily hash of IP + user-agent — lets us dedup unique
 * visitors without storing PII. Rotates every day (the date is part of the
 * hash), so it can't be used to track someone over time.
 */
export async function getVisitorKey(): Promise<string | null> {
  try {
    const h = await headers()
    const ip = (await clientIp()) ?? ""
    const ua = h.get("user-agent") || ""
    if (!ip && !ua) return null
    const day = new Date().toISOString().slice(0, 10)
    return createHash("sha256").update(`${ip}|${ua}|${day}|${SALT}`).digest("hex").slice(0, 32)
  } catch {
    return null
  }
}

/**
 * Stable (non-rotating) salted hash of IP + user-agent — a coarse device
 * identity for one-response-per-person enforcement. Unlike the daily visitor key,
 * this does NOT include the date, so it persists across days. Best-effort and not
 * PII (hashed); shared IPs/NAT are a known limitation — proper dedup keys on a
 * collected email when one exists.
 */
export async function getRespondentKey(): Promise<string | null> {
  try {
    const h = await headers()
    const ip = (await clientIp()) ?? ""
    const ua = h.get("user-agent") || ""
    if (!ip && !ua) return null
    return createHash("sha256").update(`${ip}|${ua}|${SALT}|respondent`).digest("hex").slice(0, 32)
  } catch {
    return null
  }
}

type EventType = "view" | "start" | "complete"

/** Append a funnel event. Best-effort: analytics must never break a submission. */
export async function logFormEvent(input: {
  formId: string
  type: EventType
  submissionId?: string
  visitorKey?: string | null
}): Promise<void> {
  try {
    await db.insert(formEvents).values({
      formId: input.formId,
      type: input.type,
      submissionId: input.submissionId ?? null,
      visitorKey: input.visitorKey ?? null,
    })
  } catch (err) {
    console.error("[logFormEvent] failed", err)
  }
}

/** Resolve a published form by its public id and record a view/start. */
export async function trackPublicEvent(
  publicId: string,
  type: "view" | "start",
): Promise<void> {
  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(
      and(
        eq(forms.publicId, publicId),
        eq(forms.status, "published"),
        isNull(forms.deletedAt),
      ),
    )
    .limit(1)
  if (!form) return
  const visitorKey = await getVisitorKey()
  await logFormEvent({ formId: form.id, type, visitorKey })
}
