/**
 * Mint, list and revoke MCP API keys from the command line.
 *
 * A stopgap until /settings/developers exists. It is the same code path the UI
 * will use — `mintApiKey` from src/lib/mcp/auth.ts — so a key made here is
 * identical to one made in the browser.
 *
 * The secret is printed ONCE and never stored: the database holds only an HMAC
 * of it. If it is lost, mint another and revoke the old one.
 *
 * Usage:
 *   pnpm mcp:key list
 *   pnpm mcp:key mint --workspace <id> --user <id> --name "Claude Code" \
 *                     [--scopes forms:read,forms:write] [--days 90]
 *   pnpm mcp:key revoke --id <keyId>
 *
 * With no --workspace, `list` shows the workspaces available to pick from.
 */

import "dotenv/config"
import { and, desc, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { mcpApiKeys, users, workspaceMembers, workspaces } from "@/lib/db/schema"
import { mintApiKey } from "@/lib/mcp/auth"
import { SCOPES, isScope, type Scope } from "@/lib/auth/context"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function fail(message: string): never {
  console.error(`\n${message}\n`)
  process.exit(1)
}

/** Default: everything except deletion. Destructive access is opt-in. */
const DEFAULT_SCOPES: Scope[] = SCOPES.filter((s) => s !== "destructive")

async function list() {
  const workspaceId = arg("workspace")

  if (!workspaceId) {
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        plan: workspaces.plan,
        owner: users.email,
        userId: users.id,
      })
      .from(workspaces)
      .leftJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.role, "owner")),
      )
      .leftJoin(users, eq(users.id, workspaceMembers.userId))
      .orderBy(desc(workspaces.createdAt))
      .limit(25)

    console.log("\nWorkspaces (newest first):\n")
    for (const r of rows) {
      console.log(`  ${r.name}  [${r.plan}]`)
      console.log(`    --workspace ${r.id}`)
      if (r.userId) console.log(`    --user      ${r.userId}   (${r.owner})`)
      console.log()
    }
    console.log("Then: pnpm mcp:key mint --workspace <id> --user <id> --name \"Claude Code\"\n")
    return
  }

  const keys = await db
    .select()
    .from(mcpApiKeys)
    .where(and(eq(mcpApiKeys.workspaceId, workspaceId), isNull(mcpApiKeys.revokedAt)))
    .orderBy(desc(mcpApiKeys.createdAt))

  console.log(`\n${keys.length} active key(s):\n`)
  for (const k of keys) {
    console.log(`  ${k.name}  ${k.prefix}…`)
    console.log(`    id      ${k.id}`)
    console.log(`    scopes  ${k.scopes.join(", ")}`)
    console.log(`    used    ${k.lastUsedAt?.toISOString() ?? "never"}`)
    console.log()
  }
}

async function mint() {
  const workspaceId = arg("workspace") ?? fail("--workspace is required. Run `pnpm mcp:key list`.")
  const userId = arg("user") ?? fail("--user is required. Run `pnpm mcp:key list`.")
  const name = arg("name") ?? "CLI key"

  const requested = arg("scopes")?.split(",").map((s) => s.trim()).filter(Boolean)
  const scopes: Scope[] = requested
    ? requested.map((s) => (isScope(s) ? s : fail(`Unknown scope "${s}". Valid: ${SCOPES.join(", ")}`)))
    : DEFAULT_SCOPES

  const days = arg("days") ? Number(arg("days")) : null
  const expiresAt = days ? new Date(Date.now() + days * 86_400_000) : null

  // The key acts AS this member, so it cannot be minted for someone who is not
  // one — and verification re-checks this on every request anyway.
  const [membership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1)
  if (!membership) fail("That user is not a member of that workspace.")

  const { token, keyHash, prefix } = mintApiKey()
  const [created] = await db
    .insert(mcpApiKeys)
    .values({ workspaceId, userId, name, prefix, keyHash, scopes, expiresAt })
    .returning({ id: mcpApiKeys.id })

  console.log(`
Key created — copy it now, it is not stored and cannot be shown again.

  ${token}

  id      ${created.id}
  name    ${name}
  role    ${membership.role}
  scopes  ${scopes.join(", ")}
  expires ${expiresAt?.toISOString() ?? "never"}

Connect a client:

  claude mcp add --transport http makingflow <SITE_URL>/api/mcp \\
    --header "Authorization: Bearer ${token}"
`)
}

async function revoke() {
  const id = arg("id") ?? fail("--id is required. Run `pnpm mcp:key list --workspace <id>`.")
  const [revoked] = await db
    .update(mcpApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(mcpApiKeys.id, id))
    .returning({ name: mcpApiKeys.name })
  if (!revoked) fail("No key with that id.")
  // Revocation is immediate: verification checks revokedAt on every request.
  console.log(`\nRevoked "${revoked.name}". It stops working on its next call.\n`)
}

const command = process.argv[2]
const run = command === "mint" ? mint : command === "revoke" ? revoke : list

const target = new URL(process.env.DATABASE_URL ?? "postgres://unset/unset")
console.log(`database: ${target.hostname}${target.pathname}`)

await run()
process.exit(0)
