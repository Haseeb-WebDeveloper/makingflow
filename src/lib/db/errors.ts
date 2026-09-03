/**
 * Reading Postgres error codes through Drizzle.
 *
 * Drizzle wraps driver failures in a `DrizzleQueryError` and puts the original
 * `PostgresError` on `.cause`, so the SQLSTATE is NOT on the error you catch —
 * `err.code` is `undefined` and a naive check silently never matches. That
 * turns an expected, handleable constraint violation into a generic "something
 * went wrong", which is exactly the bug this helper exists to prevent.
 *
 * Both levels are checked so this keeps working if a future Drizzle version
 * stops wrapping (or a query runs through the driver directly).
 */

/** SQLSTATE 23505 — unique_violation. */
export const UNIQUE_VIOLATION = "23505"

/** The Postgres SQLSTATE behind an error, or null if it isn't a Postgres error. */
export function pgErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null
  const direct = (err as { code?: unknown }).code
  if (typeof direct === "string") return direct
  const cause = (err as { cause?: { code?: unknown } }).cause
  if (cause && typeof cause.code === "string") return cause.code
  return null
}

/** Did this query fail because it violated a unique index/constraint? */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === UNIQUE_VIOLATION
}
