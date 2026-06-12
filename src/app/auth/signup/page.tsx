import Link from "next/link"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { SignupForm } from "@/components/auth/signup-form"
import { getOptionalUser } from "@/lib/auth/session"

export const metadata: Metadata = { title: "Create your account · MakingFlow" }

export default async function SignupPage() {
  if (await getOptionalUser()) redirect("/forms")

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
      <SignupForm />
    </AuthShell>
  )
}
