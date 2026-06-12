import type { Metadata } from "next"
import { AuthShell } from "@/components/auth/auth-shell"
import { UpdatePasswordForm } from "@/components/auth/update-password-form"

export const metadata: Metadata = { title: "Set a new password · MakingFlow" }

export default function UpdatePasswordPage() {
  return (
    <AuthShell title="Set a new password" subtitle="Choose a strong password you'll remember.">
      <UpdatePasswordForm />
    </AuthShell>
  )
}
