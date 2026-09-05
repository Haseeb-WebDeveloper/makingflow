/**
 * The consent screen: what an app may do, and where.
 *
 * Being our own authorization server pays off here. A hosted one can only ask
 * "do you allow this app?", because it does not know that this product has
 * workspaces, that a person belongs to several, or that "read responses" means
 * reading what respondents typed. We do, and we always know exactly which client
 * is asking — so the question can be the one that actually matters.
 *
 * WHAT IS TRUSTED AND WHAT IS NOT. `client_id` and `redirect_uri` arrive in a
 * query string a third party controls, so they are re-resolved here against the
 * registration table and the redirect is matched exactly — the same check
 * /authorize already did, repeated because this page is reachable directly. The
 * app's NAME is read from the database rather than the URL: it is still
 * untrusted text written by whoever registered, but at least it is the name that
 * was registered rather than one appended to a link.
 *
 * The workspace list comes from the caller's live memberships and the
 * permissions come from our own catalogue, so neither can be widened by editing
 * a URL.
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
import { resolveClientRedirect } from "@/lib/mcp/oauth/clients"

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
    redirect_uri?: string
    code_challenge?: string
    state?: string
    resource?: string
  }>
}) {
  const params = await searchParams

  const user = await getOptionalUser()
  if (!user) {
    // Come back here afterwards. `redirectTo` is same-origin-only, so the round
    // trip cannot be aimed anywhere else.
    const next = new URLSearchParams(
      Object.entries(params).filter(([, v]) => typeof v === "string") as [string, string][],
    )
    redirect(`/auth/login?redirectTo=${encodeURIComponent(`/oauth/consent?${next}`)}`)
  }

  // Re-validated rather than trusted. This page can be opened directly, so the
  // check /authorize made does not carry over on its own.
  const resolved = await resolveClientRedirect(
    params.client_id ?? null,
    params.redirect_uri ?? null,
  )
  if (!resolved.ok) {
    return (
      <Stop
        title="Something’s missing"
        subtitle="This connection link is incomplete or has expired. Start again from the app you are connecting."
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
        clientId={resolved.client.id}
        // From the registration row, not the query string. Still untrusted text
        // — an impostor may register under any name — so the form renders it as
        // plain text beside the client id, never as a link or a logo.
        clientName={resolved.client.clientName}
        redirectUri={resolved.redirectUri}
        codeChallenge={params.code_challenge ?? null}
        state={params.state ?? null}
        resource={params.resource ?? null}
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
      />
    </AuthShell>
  )
}
