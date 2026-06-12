import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { MAKINGFLOW_NAV } from "@/components/dashboard/dashboard-nav"

/**
 * Auth boundary + app chrome for the whole builder. getRequiredUser() runs the
 * real JWT + DB verification once (React cache() dedupes it with the page's
 * call) and redirects unauthenticated users to /auth/login — proxy.ts only
 * checked the cookie existed.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()

  return (
    <DashboardShell
      navItems={MAKINGFLOW_NAV}
      user={{ email: user.email, name: user.name ?? "", avatarUrl: user.avatarUrl }}
      workspace={workspace ? { name: workspace.name, plan: workspace.plan } : null}
    >
      {children}
    </DashboardShell>
  )
}
