import Link from "next/link"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { AcceptInviteButton } from "@/components/auth/accept-invite-button"
import { getInvitationByToken } from "@/lib/data/team"
import { getOptionalUser } from "@/lib/auth/session"
import { signOutAction } from "@/lib/actions/auth"

export const metadata: Metadata = { title: "Workspace invitation · MakingFlow" }

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const [invite, user] = await Promise.all([getInvitationByToken(token), getOptionalUser()])

  const invalid = !invite || invite.status !== "pending" || invite.expired

  if (invalid) {
    return (
      <AuthShell
        title="Invitation unavailable"
        subtitle="This invitation is invalid, has expired, or was already used."
      >
        <Button asChild className="h-11 w-full text-sm font-medium">
          <Link href="/forms">Go to MakingFlow</Link>
        </Button>
      </AuthShell>
    )
  }

  const inviterLabel = invite!.inviterName || invite!.inviterEmail || "Someone"
  const subtitle = (
    <>
      <strong className="text-foreground">{inviterLabel}</strong> invited you to join{" "}
      <strong className="text-foreground">{invite!.workspaceName}</strong> as {invite!.role}.
    </>
  )

  // Logged out → route into auth carrying the invite token.
  if (!user) {
    return (
      <AuthShell title="You've been invited" subtitle={subtitle}>
        <div className="space-y-3">
          <Button asChild className="h-11 w-full text-sm font-medium">
            <Link href={`/auth/signup?invite=${token}`}>Create an account to join</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 w-full text-sm font-medium">
            <Link href={`/auth/login?invite=${token}`}>I already have an account</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  // Logged in but the invite was sent to a different address.
  if (user.email.toLowerCase() !== invite!.email.toLowerCase()) {
    return (
      <AuthShell
        title="Wrong account"
        subtitle={
          <>
            This invitation was sent to{" "}
            <strong className="text-foreground">{invite!.email}</strong>, but you&apos;re signed in as{" "}
            <strong className="text-foreground">{user.email}</strong>.
          </>
        }
      >
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="h-11 w-full text-sm font-medium">
            Sign out and try again
          </Button>
        </form>
      </AuthShell>
    )
  }

  // Logged in with the matching email → one click to join.
  return (
    <AuthShell title="You've been invited" subtitle={subtitle}>
      <AcceptInviteButton token={token} />
    </AuthShell>
  )
}
