import { getRequiredUser, getDefaultWorkspace } from "@/lib/auth/session"
import { getWorkspaceForms } from "@/lib/data/forms"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { MAKINGFLOW_NAV } from "@/components/dashboard/dashboard-nav"

/**
 * Auth boundary + app chrome for the whole builder. getRequiredUser() runs the
 * real JWT + DB verification once (React cache() dedupes it with the page's
 * call) and redirects unauthenticated users to /auth/login — proxy.ts only
 * checked the cookie existed. The workspace's forms feed the sidebar list +
 * search dialog.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getRequiredUser()
  const workspace = await getDefaultWorkspace()
  const forms = await getWorkspaceForms()

  return (
    <DashboardShell
      navItems={MAKINGFLOW_NAV}
      forms={forms.map((f) => ({ id: f.id, title: f.title, status: f.status }))}
      user={{ email: user.email, name: user.name ?? "", avatarUrl: user.avatarUrl }}
      workspace={workspace ? { name: workspace.name, plan: workspace.plan } : null}
    >
      {children}
    </DashboardShell>
  )
}
