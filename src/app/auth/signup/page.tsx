import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignupForm } from "@/components/auth/signup-form"
import { getOptionalUser } from "@/lib/auth/session"

export const metadata: Metadata = { title: "Create your account · MakingFlow" }

function inviteRedirect(invite: string | undefined): string {
  return invite && /^[a-zA-Z0-9]+$/.test(invite) ? `/invite/${invite}` : "/forms"
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite } = await searchParams
  if (await getOptionalUser()) redirect(inviteRedirect(invite))

  return (
    <AuthShell
      title="Create your account"
      subtitle="Build your first form in minutes."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/auth/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {/* SignupForm reads searchParams (?invite=) → needs a Suspense boundary */}
      <Suspense fallback={<div className="h-80" aria-hidden />}>
        <SignupForm />
      </Suspense>
    </AuthShell>
  )
}
