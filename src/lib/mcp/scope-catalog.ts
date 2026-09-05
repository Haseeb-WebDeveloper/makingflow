/**
 * The permissions as a person sees them, in one place.
 *
 * Two surfaces ask a user to grant scopes — the API-key dialog on /integrations
 * and the OAuth consent screen — and they MUST describe them identically. Two
 * copies of this list would drift on the first hurried edit, and the failure
 * mode is quiet: someone reads "Read responses" on one screen and something
 * subtly different on the other, and grants what they did not mean to.
 *
 * No `server-only` here on purpose: this is display text, imported by client
 * components on both sides.
 *
 * `destructive` is deliberately ABSENT from the catalogue. It permanently
 * deletes forms and every response with them, with no undo — not something to
 * hand over with a stray click while skimming a checkbox list. It remains
 * available through `pnpm mcp:key` for the rare case that wants it.
 */

import type { Scope } from "@/lib/auth/context"

export type PermissionChoice = {
  scope: Scope
  label: string
  help: string
  /** Flagged in the UI: this one reads what respondents wrote. */
  sensitive?: boolean
}

export const PERMISSION_CHOICES: readonly PermissionChoice[] = [
  { scope: "forms:read", label: "Read forms", help: "See forms, fields and settings" },
  { scope: "forms:write", label: "Build and edit forms", help: "Create, edit and publish" },
  {
    scope: "submissions:read",
    label: "Read responses",
    help: "Includes names, emails and anything else respondents submitted",
    sensitive: true,
  },
  { scope: "submissions:write", label: "Analyse responses", help: "Run AI summaries and scoring" },
  { scope: "analytics:read", label: "Read analytics", help: "Views, completion and drop-off" },
  {
    scope: "integrations:write",
    label: "Manage integrations",
    help: "Webhooks, Sheets, Notion and notifications",
  },
  {
    scope: "team:write",
    label: "Manage the team",
    help: "Invite and remove members. Owners only, whatever is granted here",
    sensitive: true,
  },
]

/** What a connection starts with when the user has expressed no preference. */
export const DEFAULT_SCOPES: readonly Scope[] = [
  "forms:read",
  "forms:write",
  "analytics:read",
]

/** Human label for a stored scope string, for read-only lists. */
export function scopeLabel(scope: string): string {
  return PERMISSION_CHOICES.find((p) => p.scope === scope)?.label ?? scope
}
