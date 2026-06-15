import type { Metadata } from "next"
import { getRequiredUser } from "@/lib/auth/session"
import { AccountSettings } from "@/components/dashboard/account-settings"

export const metadata: Metadata = { title: "Account · MakingFlow" }

export default async function AccountSettingsPage() {
  const user = await getRequiredUser()

  return (
    <AccountSettings
      user={{
        name: user.name ?? "",
        email: user.email,
        avatarUrl: user.avatarUrl,
      }}
    />
  )
}
