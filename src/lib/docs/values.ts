/**
 * Numbers that appear in running prose, derived from the code that owns them.
 *
 * The webhooks page interpolates six policy constants into sentences — "reply
 * within 10 seconds", "reject anything more than 5 minutes old". Those are the
 * numbers a reader sizes their handler to, and the page's own header comment
 * explains why they are derived rather than typed: a hand-copied number becomes
 * public documentation lying about production the moment someone tunes it.
 *
 * MDX cannot interpolate them directly without every prose file carrying import
 * statements, which is the thing we are trying to spare a writer. So they are
 * pre-formatted here and reached through `<Val name="…" />`, which is ambient
 * in every document.
 *
 * PRE-FORMATTED STRINGS, not numbers, because the unit conversion is part of
 * the fact: the policy stores milliseconds and seconds, the prose says seconds
 * and minutes, and doing that arithmetic at each call site is how two sentences
 * end up disagreeing.
 */

import {
  JITTER_RATIO,
  MAX_ATTEMPTS,
  RETENTION_DAYS,
  RETRY_WINDOW_HOURS,
  TIMEOUT_MS,
  TIMESTAMP_TOLERANCE_SECONDS,
} from "@/lib/integrations/webhook-policy"
import { mcpEndpoint } from "@/lib/docs/site-url"

/** "30 seconds", "2 minutes", "6 hours" — for a reader, not a machine. */
export function humanDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`
  if (seconds < 3600) {
    const minutes = seconds / 60
    return `${minutes} minute${minutes === 1 ? "" : "s"}`
  }
  const hours = seconds / 3600
  return `${hours} hour${hours === 1 ? "" : "s"}`
}

export const DOC_VALUES = {
  "webhook.timeoutSeconds": String(TIMEOUT_MS / 1000),
  "webhook.replayWindowMinutes": String(TIMESTAMP_TOLERANCE_SECONDS / 60),
  "webhook.replayWindowSeconds": String(TIMESTAMP_TOLERANCE_SECONDS),
  "webhook.jitterPercent": `${JITTER_RATIO * 100}%`,
  "webhook.maxAttempts": String(MAX_ATTEMPTS),
  "webhook.retentionDays": String(RETENTION_DAYS),
  "webhook.retryWindow": `about ${RETRY_WINDOW_HOURS} hours`,
  "mcp.endpoint": mcpEndpoint(),
} as const

export type DocValueKey = keyof typeof DOC_VALUES

export function isDocValueKey(name: string): name is DocValueKey {
  return name in DOC_VALUES
}
