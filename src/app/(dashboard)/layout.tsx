import { getRequiredUser, getDefaultWorkspace, getMyWorkspaces } from "@/lib/auth/session"
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
  const [workspace, workspaces] = await Promise.all([
    getDefaultWorkspace(),
    getMyWorkspaces(),
  ])
  const forms = workspace ? await getWorkspaceForms(workspace.id) : []

  return (
    <DashboardShell
      navItems={MAKINGFLOW_NAV}
      forms={forms.map((f) => ({
        id: f.id,
        title: f.title,
        status: f.status,
        publicId: f.publicId,
      }))}
      user={{ email: user.email, name: user.name ?? "", avatarUrl: user.avatarUrl }}
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        plan: w.plan,
        role: w.role,
      }))}
      activeWorkspaceId={workspace?.id ?? null}
    >
      {children}
    </DashboardShell>
  )
}
