import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { getOptionalUser } from "@/lib/auth/session"

export const metadata: Metadata = { title: "Sign in · MakingFlow" }

function inviteRedirect(invite: string | undefined): string {
  return invite && /^[a-zA-Z0-9]+$/.test(invite) ? `/invite/${invite}` : "/forms"
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite } = await searchParams
  if (await getOptionalUser()) redirect(inviteRedirect(invite))

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your MakingFlow account."
      footer={
        <>
          New to MakingFlow?{" "}
          <Link href="/auth/signup" className="font-medium text-foreground hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {/* LoginForm reads searchParams → needs a Suspense boundary in Next 16 */}
      <Suspense fallback={<div className="h-72" aria-hidden />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
