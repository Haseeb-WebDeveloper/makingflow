import Link from "next/link"
import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"

export const metadata: Metadata = { title: "Check your email · MakingFlow" }

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; email?: string }>
}) {
  const { mode, email } = await searchParams
  const isMagic = mode === "magic"

  return (
    <AuthShell
      title="Check your email"
      subtitle={
        email ? (
          <>
            We sent a {isMagic ? "magic sign-in" : "confirmation"} link to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </>
        ) : (
          <>We sent you a {isMagic ? "magic sign-in" : "confirmation"} link.</>
        )
      }
      footer={
        <Link href="/auth/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>
          Open the link on this device to{" "}
          {isMagic ? "sign in" : "finish creating your account"}. The link expires
          shortly, so use it soon.
        </p>
        <p>
          Didn&apos;t get it? Check your spam folder, or{" "}
          <Link
            href={isMagic ? "/auth/login" : "/auth/signup"}
            className="font-medium text-foreground hover:underline"
          >
            try again
          </Link>
          .
        </p>
      </div>
    </AuthShell>
  )
}
