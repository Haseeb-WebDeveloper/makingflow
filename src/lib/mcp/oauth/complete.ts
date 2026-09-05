import "server-only"

/**
 * Resuming the authorization flow after we have identified the user.
 *
 * Lives here rather than in the route because two callers need it: the Login URI
 * itself, and the same route re-entered after our consent screen. The flow
 * pauses for our question — which workspaces, and what may the app do in them —
 * and resumes at exactly this point.
 */

import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { completeAuthorization } from "@/lib/mcp/oauth/authkit"

export async function completeAndRedirect(
  externalAuthId: string,
  userId: string,
): Promise<Response> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return new Response("Unknown account", { status: 401 })

  // The authorization server wants first and last name separately; we store one
  // name. Splitting on the first space is wrong for a great many names, so the
  // whole thing goes in `firstName` rather than being mangled into halves.
  const result = await completeAuthorization(externalAuthId, {
    id: row.id,
    email: row.email,
    firstName: row.name,
  })
  if (!result.ok) {
    return new Response(result.error, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }

  // Throws, so nothing after this runs.
  redirect(result.redirectUri)
}
