import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { customDomains, forms, type DomainVerification } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { isVercelConfigured, VERCEL_CNAME_TARGET } from "@/lib/domains/vercel"

export type WorkspaceDomain = {
  id: string
  domain: string
  status: "pending" | "active" | "error"
  verification: DomainVerification[]
  formsCount: number
}

export type WorkspaceDomains = {
  configured: boolean
  cnameTarget: string
  domains: WorkspaceDomain[]
}

/** All custom domains in the caller's workspace, with how many forms use each. */
export async function getWorkspaceDomains(): Promise<WorkspaceDomains | null> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return null

  const rows = await db
    .select({
      id: customDomains.id,
      domain: customDomains.domain,
      status: customDomains.status,
      verification: customDomains.verification,
      formsCount: sql<number>`(
        select count(*)::int from ${forms}
        where ${forms.customDomainId} = ${customDomains.id} and ${forms.deletedAt} is null
      )`,
    })
    .from(customDomains)
    .where(eq(customDomains.workspaceId, workspace.id))
    .orderBy(desc(customDomains.createdAt))

  return {
    configured: isVercelConfigured(),
    cnameTarget: VERCEL_CNAME_TARGET,
    domains: rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      status: r.status,
      verification: r.verification ?? [],
      formsCount: r.formsCount,
    })),
  }
}

/** Active domains a form can be published to (for the form's domain picker). */
export async function getActiveDomains(): Promise<{ id: string; domain: string }[]> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return []
  return db
    .select({ id: customDomains.id, domain: customDomains.domain })
    .from(customDomains)
    .where(and(eq(customDomains.workspaceId, workspace.id), eq(customDomains.status, "active")))
    .orderBy(customDomains.domain)
}
