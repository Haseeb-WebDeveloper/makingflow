/**
 * One error vocabulary for every way an import can fail.
 *
 * Shared by both readers — the public-page one (./tally-page.ts) and the
 * API-key one (./tally-api.ts) — so a caller maps a code to a message once
 * rather than once per source.
 *
 * Every code is something the READER can act on. That is the point of having
 * codes at all: an import that fails should say which knob to turn, not
 * "something went wrong".
 */

export type TallyFetchError =
  // Public-page reader
  | "INVALID_URL"
  | "PASSWORD_PROTECTED"
  | "NO_DEFINITION"
  // API-key reader
  | "INVALID_KEY"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  // Either
  | "NOT_FOUND"
  | "UNREACHABLE"

export class TallyImportError extends Error {
  constructor(readonly code: TallyFetchError, message: string) {
    super(message)
    this.name = "TallyImportError"
  }
}

export const TALLY_ERROR_MESSAGES: Record<TallyFetchError, string> = {
  INVALID_URL:
    "That doesn't look like a Tally form link. Paste the share link, which looks like https://tally.so/r/abc123.",
  NOT_FOUND:
    "Tally has no form at that link. Check it's the share link for a form that's still published.",
  PASSWORD_PROTECTED:
    "That form is password-protected, so its questions aren't public. Remove the password in Tally, or import with an API key instead.",
  NO_DEFINITION:
    "We reached the form but couldn't read its questions. Tally may have changed how its pages are built — please let us know.",
  INVALID_KEY:
    "Tally rejected that API key. Copy it again from Tally → Settings → API keys, and check it wasn't revoked.",
  FORBIDDEN:
    "That API key can't read this form. It may belong to a different Tally account.",
  RATE_LIMITED:
    "Tally is rate-limiting us (100 requests a minute). Wait a minute and import the rest.",
  UNREACHABLE: "We couldn't reach Tally. Try again in a moment.",
}

/** The user-facing message for a thrown error, or a generic line for anything else. */
export function tallyErrorMessage(err: unknown, fallback: string): string {
  return err instanceof TallyImportError ? err.message : fallback
}
