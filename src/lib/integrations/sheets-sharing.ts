import "server-only"

import type { SheetShare, SheetSharingSetting } from "@/lib/db/schema"

/**
 * Giving the workspace's members access to the spreadsheets a connected Google
 * account owns.
 *
 * The files live in one person's Drive, so without this the only way a teammate
 * sees the responses in Sheets is for that person to open every spreadsheet and
 * add them by hand — once per form, again for every new form, and again for every
 * new member. This module holds the decision (who should have access, what has to
 * change) and the application of it (the Drive calls, and what we record).
 */

/** Case-insensitive, whitespace-free comparison key for an address. */
const key = (email: string) => email.trim().toLowerCase()

/**
 * Who should be able to open the spreadsheets this connection owns.
 *
 * The account's own address is always excluded: Drive refuses to share a file
 * with its owner, and recording that refusal would park a permanent "blocked"
 * row on the card for the one person who definitely has access.
 */
export function desiredShareEmails(
  setting: SheetSharingSetting | undefined,
  memberEmails: string[],
  ownerEmail: string,
): string[] {
  if (!setting) return []
  const owner = key(ownerEmail)
  const chosen = setting.audience === "all" ? null : new Set(setting.audience.emails.map(key))
  const seen = new Set<string>()
  const out: string[] = []
  for (const email of memberEmails) {
    const k = key(email)
    if (k === owner || seen.has(k)) continue
    if (chosen && !chosen.has(k)) continue
    seen.add(k)
    out.push(email)
  }
  return out
}

/**
 * What has to change on one spreadsheet for the right people to have the right
 * access.
 *
 * THE RULE: `revoke` only ever contains entries carrying a `permissionId` we
 * recorded. An entry without one is either a failed attempt of ours or a share
 * the account's owner made by hand in Drive — and removing somebody's manual
 * share to tidy up our own bookkeeping is a far worse bug than leaving a stale
 * grant in place.
 *
 * A role change is expressed as a revoke plus a grant rather than a patch: one
 * code path instead of two, and the id we have recorded stays true at every step.
 */
export function planShareChanges(
  desired: string[],
  role: "reader" | "writer",
  current: SheetShare[],
): { grant: string[]; revoke: SheetShare[]; keep: SheetShare[] } {
  const wanted = new Map(desired.map((e) => [key(e), e]))
  const grant: string[] = []
  const revoke: SheetShare[] = []
  const keep: SheetShare[] = []

  for (const share of current) {
    const k = key(share.email)
    const stillWanted = wanted.has(k)
    const correctRole = share.role === role
    const isOurs = Boolean(share.permissionId)

    if (stillWanted && correctRole && isOurs) {
      keep.push(share)
      wanted.delete(k)
      continue
    }
    if (isOurs) revoke.push(share)
    // An entry with no permissionId is left for the grant loop below to retry
    // (if still wanted) or simply forgotten (if not). Never revoked.
  }

  for (const email of wanted.values()) grant.push(email)
  return { grant, revoke, keep }
}
