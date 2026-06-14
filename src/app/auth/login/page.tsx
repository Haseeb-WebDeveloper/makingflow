import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { LoginForm } from "@/components/auth/login-form"
import { getOptionalUser } from "@/lib/auth/session"

export const metadata: Metadata = { title: "Sign in · MakingFlow" }

export default async function LoginPage() {
  if (await getOptionalUser()) redirect("/forms")

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
      <Suspense fallback={<div className="h-72 lg:h-[20vw]" aria-hidden />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
