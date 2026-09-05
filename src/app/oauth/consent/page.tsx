/**
 * The consent screen an OAuth client sends the user to.
 *
 * This is where the grant is actually decided, and it is deliberately OURS
 * rather than the authorization server's. The AS knows about clients and tokens;
 * it does not know that this product has workspaces, that a user belongs to
 * several, or that "read responses" means reading what respondents typed. Only
 * we can ask the question in terms the person can answer.
 *
 * The page is careful about what it treats as trustworthy. `client_id` and
 * `client_name` arrive in the query string, from a redirect a third party
 * controls — so the name is rendered as plain text and never as a link or logo,
 * because a connected-app name is the obvious place to write "MakingFlow
 * Official" and hope nobody looks closely. The workspace list, by contrast,
 * comes from the caller's live memberships, and the scopes offered come from our
 * own catalogue, so neither can be widened by editing a URL.
 */

import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { ConsentForm } from "@/components/integrations/consent-form"
import { getOptionalUser } from "@/lib/auth/session"
import { sessionContext } from "@/lib/auth/context-web"
import { grantableWorkspaces } from "@/lib/core/mcp-keys"
import { isOauthConfigured } from "@/lib/mcp/oauth/config"

export const metadata: Metadata = { title: "Connect an app · MakingFlow" }

/** A dead end the user can get out of. Every refusal here ends up somewhere. */
function Stop({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <AuthShell title={title} subtitle={subtitle}>
      <Button asChild className="h-11 w-full text-sm font-medium">
        <Link href="/integrations">Go to MakingFlow</Link>
      </Button>
    </AuthShell>
  )
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{
    client_id?: string
    client_name?: string
    redirect_uri?: string
    state?: string
    external_auth_id?: string
  }>
}) {
  if (!isOauthConfigured()) {
    return (
      <Stop
        title="Not available"
        subtitle="This deployment doesn’t have app connections enabled."
      />
    )
  }

  const params = await searchParams
  const clientId = params.client_id?.trim()

  const user = await getOptionalUser()
  if (!user) {
    // Come back here afterwards. `redirectTo` is same-origin-only, so the round
    // trip cannot be aimed anywhere else.
    const next = new URLSearchParams(
      Object.entries(params).filter(([, v]) => typeof v === "string") as [string, string][],
    )
    redirect(`/auth/login?redirectTo=${encodeURIComponent(`/oauth/consent?${next}`)}`)
  }

  if (!clientId) {
    return (
      <Stop
        title="Something’s missing"
        subtitle="This connection link is incomplete. Start again from the app you are connecting."
      />
    )
  }

  const auth = await sessionContext("server-action")
  if (!auth.ok) redirect("/auth/login")

  const workspaces = await grantableWorkspaces(auth.ctx)
  if (workspaces.length === 0) {
    return (
      <Stop
        title="No workspaces yet"
        subtitle="Create a workspace before connecting an app to it."
      />
    )
  }

  return (
    <AuthShell
      title="Connect an app"
      subtitle="Choose what this app may do, and which workspaces it may reach."
    >
      <ConsentForm
        clientId={clientId}
        // Untrusted: supplied by whoever registered the client. Rendered as
        // text, never as a link, and truncated by the component.
        clientName={params.client_name ?? null}
        redirectUri={params.redirect_uri ?? null}
        state={params.state ?? null}
        // Present when this ran mid-flow: approving resumes the handshake
        // rather than dropping the user on a settings page.
        externalAuthId={params.external_auth_id ?? null}
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
      />
    </AuthShell>
  )
}
