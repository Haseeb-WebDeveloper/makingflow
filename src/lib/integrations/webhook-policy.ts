/**
 * The delivery promises we make, in one place.
 *
 * These numbers are published on /docs/webhooks and people build against them:
 * a retry schedule someone has written alerting around, a timeout they size
 * their handler to fit. They were previously duplicated between the sender and
 * that page, kept in step by a comment — which works right up until somebody
 * tunes the backoff and the public documentation quietly starts lying about
 * behaviour a customer depends on.
 *
 * NO IMPORTS, deliberately. The docs page is a plain server component and must
 * not drag a database connection in just to render a table.
 */

/**
 * Waits before each retry. The first attempt is immediate, so this starts at
 * the FIRST retry: 30s, 2m, 10m, 1h, 6h.
 */
export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600] as const

/** Attempts including the immediate one. Past this a delivery is exhausted. */
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1

/** How long we wait for a receiver before calling the attempt failed. */
export const TIMEOUT_MS = 10_000

/** How far out of date a signature's `t=` may be before a receiver refuses it. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300

/** How long a delivery record — including the body we sent — is kept. */
export const RETENTION_DAYS = 30

/** Jitter applied to each wait, so a recovering receiver is not hit in lockstep. */
export const JITTER_RATIO = 0.2

/**
 * How long a failing delivery keeps being retried, end to end.
 *
 * Derived rather than described, because it was described twice and wrongly:
 * the public guide said "about 8 hours" and the in-app sheet said "about eight
 * hours", while the real ladder totals 7.2. Someone sizing an alert window was
 * being told we try for longer than we do.
 */
export const TOTAL_RETRY_SECONDS = BACKOFF_SECONDS.reduce((sum, s) => sum + s, 0)

/** Rounded DOWN: never promise a longer window than we actually run. */
export const RETRY_WINDOW_HOURS = Math.floor(TOTAL_RETRY_SECONDS / 3600)
