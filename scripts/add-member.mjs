// Put somebody straight into a workspace — account, membership, and an
// invitation already marked accepted — without sending a single email.
//
//   node scripts/add-member.mjs --email a@b.com --workspace my-slug --role owner
//   node scripts/add-member.mjs --email a@b.com --workspace my-slug --role owner --apply
//
// The first form only reports what it WOULD do. Nothing is written without
// --apply, because this touches whatever database DATABASE_URL names — usually
// production — and creates a real, immediately-usable login.
//
// What it does, mirroring what the app itself writes (see inviteMember in
// src/lib/core/team.ts and acceptInvitationByToken in src/lib/data/team.ts):
//
//   1. a Supabase auth user with the email ALREADY CONFIRMED (no verification
//      mail), or reuses the one that exists
//   2. the public.users row, keyed by that auth uid — the app's own
//      provisionUser is idempotent, so a later sign-in passes straight through
//      and, because the person is already in a workspace, does NOT get a
//      personal one made for them
//   3. a workspace_invitations row with status 'accepted', so the team screen's
//      history reads the way it would if they had clicked a real invite
//   4. the workspace_members row with the requested role
//
// NOT done here: granting the new member access to the workspace's existing
// Google spreadsheets. The app does that on invite acceptance
// (reconcileWorkspaceSheetShares), which needs the app's own token decryption.
// This script reports whether the workspace has any sharing setting at all, and
// what to do about it if it does.
//
import postgres from "postgres"
import fs from "node:fs"
import crypto from "node:crypto"

const root = new URL("..", import.meta.url)

/** Read one var out of .env — same approach as scripts/verify-db.mjs. */
function fromEnvFile(name) {
  const envPath = new URL(".env", root)
  if (!fs.existsSync(envPath)) return null
  return fs
    .readFileSync(envPath, "utf8")
    .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "")
}

function env(name) {
  return process.env[name] || fromEnvFile(name)
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const EMAIL = (arg("email") || "").trim().toLowerCase()
const WORKSPACE = (arg("workspace") || "").trim()
const ROLE = arg("role", "member")
const NAME = arg("name")
const APPLY = process.argv.includes("--apply")

if (!EMAIL || !WORKSPACE) {
  console.error("usage: node scripts/add-member.mjs --email <email> --workspace <slug|uuid> [--role owner|member] [--name <name>] [--password <pw>] [--apply]")
  process.exit(1)
}
if (ROLE !== "owner" && ROLE !== "member") {
  console.error(`--role must be "owner" or "member", got "${ROLE}"`)
  process.exit(1)
}

const DATABASE_URL = env("DATABASE_URL")
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL")
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
if (!DATABASE_URL || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("need DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

/** A password nobody has to remember: they can reset it, or use the magic link. */
function generatePassword() {
  return `Mf-${crypto.randomBytes(12).toString("base64url")}-1a`
}
const PASSWORD = arg("password", generatePassword())

const sql = postgres(DATABASE_URL, { prepare: false, max: 1 })

async function adminApi(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`admin API ${path} → ${res.status} ${body}`)
  return body ? JSON.parse(body) : null
}

try {
  // ── The workspace ────────────────────────────────────────────────────────
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(WORKSPACE)
  const [workspace] = isUuid
    ? await sql`select id, name, slug, plan from workspaces where id = ${WORKSPACE}`
    : await sql`select id, name, slug, plan from workspaces where slug = ${WORKSPACE}`
  if (!workspace) throw new Error(`no workspace matching "${WORKSPACE}"`)

  const members = await sql`
    select u.id, u.email, u.name, m.role
    from workspace_members m
    join users u on u.id = m.user_id
    where m.workspace_id = ${workspace.id}
    order by m.role, u.email
  `
  console.log(`workspace: ${workspace.name} (${workspace.slug}) ${workspace.id} — plan ${workspace.plan}`)
  console.log(`members (${members.length}):`)
  for (const m of members) console.log(`  ${m.role.padEnd(6)} ${m.email}${m.name ? ` — ${m.name}` : ""}`)

  // ── Who, if anyone, this person already is ───────────────────────────────
  const [authUser] = await sql`
    select id, email, email_confirmed_at, created_at from auth.users where lower(email) = ${EMAIL}
  `
  const [appUser] = await sql`select id, email, name from users where lower(email) = ${EMAIL}`
  const alreadyMember = members.find((m) => m.email.toLowerCase() === EMAIL)

  console.log(`\ntarget: ${EMAIL} (role ${ROLE})`)
  console.log(`  auth.users:         ${authUser ? `${authUser.id}${authUser.email_confirmed_at ? " (confirmed)" : " (UNCONFIRMED)"}` : "none"}`)
  console.log(`  public.users:       ${appUser ? appUser.id : "none"}`)
  console.log(`  member here:        ${alreadyMember ? alreadyMember.role : "no"}`)

  // ── Sheets: will the new member see the existing spreadsheets? ───────────
  const [conn] = await sql`
    select account_email, metadata from workspace_connections
    where workspace_id = ${workspace.id} and provider = 'google'
  `
  if (conn) {
    const share = conn.metadata?.google?.share ?? null
    console.log(`\ngoogle sheets: connected as ${conn.account_email}`)
    console.log(`  workspace sharing setting: ${share ? JSON.stringify(share) : "none (sheets are private to that account)"}`)
    if (share) {
      console.log("  → after this, open /integrations and save the sharing dialog once to grant")
      console.log("    the new member access to the sheets that already exist.")
    }
  } else {
    console.log("\ngoogle sheets: not connected for this workspace")
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to:")
    if (!authUser) console.log(`  • create the Supabase auth user (email pre-confirmed), password: ${PASSWORD}`)
    else if (!authUser.email_confirmed_at) console.log("  • confirm the existing auth user's email")
    if (!appUser) console.log("  • insert the public.users row")
    console.log("  • insert a workspace_invitations row with status 'accepted'")
    if (alreadyMember) console.log(`  • change their role from ${alreadyMember.role} to ${ROLE}`)
    else console.log(`  • insert the workspace_members row as ${ROLE}`)
    process.exit(0)
  }

  // ── 1. The login ─────────────────────────────────────────────────────────
  let userId = authUser?.id
  let issuedPassword = null
  if (!userId) {
    const created = await adminApi("/users", {
      method: "POST",
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true, // no verification mail; they can sign in immediately
        ...(NAME ? { user_metadata: { name: NAME } } : {}),
      }),
    })
    userId = created.id
    issuedPassword = PASSWORD
    console.log(`\ncreated auth user ${userId} (email confirmed)`)
  } else {
    if (!authUser.email_confirmed_at) {
      await adminApi(`/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ email_confirm: true }),
      })
      console.log(`\nconfirmed the existing auth user ${userId}`)
    } else {
      console.log(`\nreusing the existing auth user ${userId}`)
    }
  }

  // ── 2-4. The app rows, in one transaction ────────────────────────────────
  const token = crypto.randomUUID().replace(/-/g, "")
  const invitedBy = members.find((m) => m.role === "owner")?.id ?? null

  await sql.begin(async (tx) => {
    await tx`
      insert into users (id, email, name)
      values (${userId}, ${EMAIL}, ${NAME})
      on conflict (id) do update set email = excluded.email,
        name = coalesce(excluded.name, users.name)
    `

    // The invitation exists so the team screen has a history to show; it is
    // born accepted, and its expiry is in the past on purpose — nobody should
    // be able to reuse this token as a live invite link.
    await tx`
      insert into workspace_invitations (workspace_id, email, role, token, status, invited_by_id, expires_at)
      values (${workspace.id}, ${EMAIL}, ${ROLE}, ${token}, 'accepted', ${invitedBy},
              now() - interval '1 second')
    `

    await tx`
      insert into workspace_members (workspace_id, user_id, role)
      values (${workspace.id}, ${userId}, ${ROLE})
      on conflict (workspace_id, user_id) do update set role = excluded.role
    `
  })

  const after = await sql`
    select u.email, m.role from workspace_members m
    join users u on u.id = m.user_id
    where m.workspace_id = ${workspace.id}
    order by m.role, u.email
  `
  console.log(`\n${workspace.name} now has ${after.length} members:`)
  for (const m of after) console.log(`  ${m.role.padEnd(6)} ${m.email}`)
  if (issuedPassword) console.log(`\npassword for ${EMAIL}: ${issuedPassword}`)
  console.log("(they can change it from the app, or use “Forgot password”.)")
} catch (err) {
  console.error(`\nfailed: ${err.message}`)
  process.exitCode = 1
} finally {
  await sql.end()
}
