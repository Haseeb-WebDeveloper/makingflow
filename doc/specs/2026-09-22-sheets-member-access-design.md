# Member access to response spreadsheets

Design, 2026-09-22. Status: approved, not yet implemented.

## The problem

A workspace connects one Google account and every form's responses land in a
spreadsheet in **that account's Drive**. Nobody else can open those files. The
only way to let a teammate see the responses in Sheets today is for the owner of
the account to open each spreadsheet in Drive and add each person by hand — once
per form, forever, and again for every new form.

Figmenta has three members and four spreadsheets — eight manual shares once the
account's own owner is excluded, and nobody is going to keep that up to date.

This adds one setting: give workspace members access to the spreadsheets
automatically, and keep that access correct as people and forms come and go.

## What was verified before designing this

Probed against Figmenta's live Google connection, because the feasibility of the
whole feature rests on it:

- Granted scopes are `openid`, `email`, `profile`,
  `https://www.googleapis.com/auth/drive.file`. Drive reports
  `capabilities.canShare: true` on spreadsheets our app created, so
  `permissions.create` works **with the consent we already hold** — no new
  scope, no new consent screen, no Google verification review, and no
  re-authorisation for accounts already connected.
- Drive calls **must** pass `supportsAllDrives=true`. One of Figmenta's
  spreadsheets lives in a Shared Drive (`driveId` present); `files.get` on it
  returns `404 File not found` without the flag while the Sheets API reads it
  happily. Omit the flag and the feature breaks for exactly the Google Workspace
  customers most likely to want it, in the least debuggable way.
- `workspace_members` + `users.email` already give us the audience, and
  `src/lib/core/team.ts` already owns joining and removal — the hook points
  exist.

## Model

Sharing is a property of **the connected Google account**, not of a form. The
account owns the files; disconnect it and the setting is meaningless. So the
setting lives on the connection and the grants live with each destination.

### The setting — `workspace_connections.metadata`

`ConnectionMetadata` gains a `google` key, mirroring the existing `notion` one:

```ts
export type ConnectionMetadata = {
  notion?: { parentPageId?: string; workspaceId?: string; botId?: string }
  google?: {
    /** Absent = sharing off. */
    share?: {
      role: "reader" | "writer"
      /** Everyone in the workspace, or an explicit list of member emails. */
      audience: "all" | { emails: string[] }
    }
  }
}
```

Off is the absence of `share`, so every existing connection reads as off without
a backfill.

### The grants — `form_integrations.config`

`GoogleSheetsIntegrationConfig` gains:

```ts
  /**
   * Who we have given access to this spreadsheet, and what became of each
   * attempt. `permissionId` present means WE created that grant and may remove
   * it; its absence with an `error` means the attempt failed and why.
   */
  shares?: {
    email: string
    role: "reader" | "writer"
    permissionId?: string
    error?: "domain_policy" | "not_a_google_account" | "failed"
    syncedAt?: string
  }[]
```

Both stores are jsonb, so **this feature needs no migration**.

`permissionId` is the load-bearing field. It is the only thing that lets
reconciliation distinguish a grant we made from a share a human made in Drive,
and the rule that follows from it is absolute: **we never delete a permission we
have no recorded id for.** Revoking someone's hand-made share to satisfy our own
bookkeeping would be a far worse bug than a stale grant.

## Components

### 1. Drive layer — `src/lib/integrations/google.ts`

Two functions beside the existing Sheets helpers, using a `driveFetch` twin of
`sheetsFetch` (same error shape, `DRIVE_API` base):

```ts
shareFile(accessToken, fileId, email, role): Promise<{ permissionId: string }>
unshareFile(accessToken, fileId, permissionId): Promise<void>
```

- `shareFile` POSTs `{ type: "user", role, emailAddress }` with
  `sendNotificationEmail=false` (we are not going to mail three people per form)
  and `supportsAllDrives=true`.
- `unshareFile` DELETEs and treats `404` as success — already gone is the
  outcome we wanted.
- Both classify failures rather than leaking status codes upward: a `403`
  naming the domain policy becomes `domain_policy`, a `400` on the address
  becomes `not_a_google_account`, everything else is `failed`.

### 2. Reconciler — `src/lib/integrations/sheets-sharing.ts` (new)

One exported function per unit of work:

```ts
reconcileSheetShares(conn, row): Promise<void>        // one integration row
reconcileWorkspaceSheetShares(workspaceId): Promise<void>  // every sheet in a workspace
```

`reconcileSheetShares` is the whole algorithm:

1. **Desired**: nothing if `share` is absent. Otherwise the workspace's member
   emails, narrowed to `audience.emails` when the audience is a list, minus the
   connected account's own `accountEmail` — Drive rejects sharing a file with
   its owner, and that rejection would otherwise look like a real failure to the
   person reading the card.
2. **Diff** against `config.shares`: create what is missing or whose role
   changed; delete only entries that carry a `permissionId` and are no longer
   desired.
3. **Apply** one Drive call per change, recording each outcome — id on success,
   classified `error` on failure.
4. **Persist** the rebuilt `shares` array in a single UPDATE guarded on the row
   id and on `config->>'connectionId'`, so a concurrent re-provision (an account
   switch) wins cleanly instead of resurrecting grants on a spreadsheet that is
   no longer the destination.

It never throws. Sharing is a convenience on top of delivery; a Drive outage must
not cost anyone a response. That is the degrade-gracefully rule in AGENTS.md
applied one level down.

`reconcileWorkspaceSheetShares` is serial and capped the way
`ensureWorkspaceSheets` is — Google rate-limits, and a workspace with fifty forms
times three members is a hundred and fifty calls.

### 3. Triggers

| When | Where | Why |
| --- | --- | --- |
| A spreadsheet is created or replaced | `ensureFormSheet`, `enableFormSheet`, the lazy branch of `syncSubmissionToSheets`, `reprovisionOrphanedSheet` | A new file has no permissions; an account switch makes a new file |
| The setting changes | `setSheetSharing` | The point of the setting |
| Someone joins | `acceptInvitationByToken` (`src/lib/data/team.ts`) | They should not have to ask |
| Someone is removed | `removeMember` (`src/lib/core/team.ts`) | Leaving the workspace has to mean leaving the data |
| "Re-check access" | `reconcileSheetSharing` action | The recovery path for a blocked or failed grant |

Deferred with `after()` where a request scope exists, called directly where it
does not (the re-provisioning path already runs outside one). No cron: every
state change that matters has a trigger, and the button covers the rest.

### 4. Permissions and actions

Sharing other people's access to a personal Google account is an admin decision,
so it is owner-gated — unlike the rest of the integrations surface, which is
deliberately open to any member and stays that way.

- `src/lib/auth/roles.ts`: `WorkspaceAction` gains `manage_integrations`, listed
  in `OWNER_ONLY`.
- `src/lib/core/integrations.ts`: `setSheetSharing(ctx, share | null)` and
  `reconcileSheetSharing(ctx)`, both opening with
  `authorize(ctx, { scopes: ["integrations:write"], action: "manage_integrations" })`.
- `src/lib/actions/integrations.ts`: thin server actions over both, per the
  never-inline-an-action rule.
- `src/lib/data/integrations.ts`: `getWorkspaceIntegrations` returns the current
  setting plus a per-member roll-up (`shared` / `blocked` / `failed`, with the
  reason and how many spreadsheets each covers) for the card to render.

### 5. UI — the Google Sheets card on `/integrations`

```
Give members access to response spreadsheets
( ) Off   (•) Viewer   ( ) Editor
(•) All members   ( ) Only selected…

garima.m@figmenta.com      shared · viewer
haseeb.figmenta@gmail.com  blocked — figmenta.com does not allow sharing
                           outside the domain              [Re-check access]
```

- Default **Viewer**. An Editor can reorder or delete columns, and the
  append-only column layout assumes the header row holds still; nobody should
  land there by accepting a default.
- The copy names the owning account — "Members get access to spreadsheets in
  `garima.m@figmenta.com`'s Drive" — because whose Drive it is is the thing
  people get wrong, as this workspace has already demonstrated.
- Members see the state read-only; the controls are owner-only.
- A line pointing out that every member can already read responses inside
  MakingFlow, so this is for people who work in Sheets.

## Error handling

- Every Drive failure is recorded against the member on the form and surfaced in
  the card. Nothing is retried in a loop: a domain policy or a non-Google address
  will not fix itself, and the Re-check button is the retry.
- **Expected on day one at Figmenta**: `figmenta.com` may refuse sharing to the
  workspace's two gmail.com members. That shows as `blocked` with the reason.
- No fallback to link-based sharing ("anyone with the link can view"), ever —
  not as an option, not as a rescue for a blocked grant. Responses are personal
  data; the failure mode of a link is a public spreadsheet of applicants.
- A sharing failure never fails a delivery, and never blocks provisioning.

## Testing

Unit (`tests/unit/`):

- the desired-set computation: audience `all` vs a list, owner's own address
  excluded, role change counts as a change
- the diff: additions, removals, no-ops, and that an entry without a
  `permissionId` is never scheduled for deletion

Integration (`tests/integration/`, real test DB, Drive stubbed the way
`sheets-account-switch.test.ts` stubs Sheets):

- setting turned on records a grant per member with its permission id
- removing a member deletes that member's grant and drops it from the config
- a blocked member is recorded with a reason while the others are still shared
- a hand-made share (an entry with no `permissionId`, or a permission we never
  recorded) is never deleted
- reconciling twice makes no further Drive calls
- an account switch re-provisions the sheet and re-shares the new file
- with sharing off, no Drive call is made at all

## Out of scope

- **Per-form Google accounts.** A separate decision; see the discussion that
  produced this spec. Sharing solves "my team needs the data"; multiple accounts
  only matter when file *ownership* must differ.
- **Notion.** The same gap exists — a database in one person's Notion workspace —
  but the API cannot add people to it. Nothing to build yet.
- **Cron reconciliation.** Event triggers plus the button cover it; add one only
  if drift shows up in practice.
- **Google Groups or domain-wide sharing.** Per-member grants first.
