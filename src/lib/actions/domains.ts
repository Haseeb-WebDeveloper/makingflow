"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { customDomains } from "@/lib/db/schema"
import { getDefaultWorkspace } from "@/lib/auth/session"
import {
  isVercelConfigured,
  vercelAddDomain,
  vercelGetDomainStatus,
  vercelRemoveDomain,
} from "@/lib/domains/vercel"

type Result = { success: true } | { success: false; error: string }

/** Strip scheme/path/port/whitespace and lowercase — accept what users paste. */
function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, "")
  d = d.split("/")[0] // drop any path
  d = d.split(":")[0] // drop any port
  d = d.replace(/\.$/, "") // drop trailing dot
  return d
}

const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

/** v1 supports subdomains only — require at least three labels (sub.domain.tld). */
function isValidSubdomain(domain: string): boolean {
  if (!HOSTNAME_RE.test(domain)) return false
  return domain.split(".").length >= 3
}

/**
 * Register a custom subdomain for the workspace: validate it, add it to our
 * Vercel project, and store it as `pending` with its DNS challenges. The user
 * then points DNS at us and we verify via checkCustomDomain.
 */
export async function addCustomDomain(rawDomain: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }
  if (!isVercelConfigured()) {
    return { success: false, error: "Custom domains aren't configured on this deployment yet." }
  }

  const domain = normalizeDomain(rawDomain)
  if (!domain) return { success: false, error: "Enter a domain." }
  if (!isValidSubdomain(domain)) {
    return {
      success: false,
      error: "Use a subdomain like forms.yourbrand.com (root domains aren't supported yet).",
    }
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.toLowerCase()
  if (rootDomain && (domain === rootDomain || domain.endsWith(`.${rootDomain}`))) {
    return { success: false, error: "That domain belongs to MakingFlow." }
  }

  // Globally unique (the domain can only live on one project/workspace).
  const [taken] = await db
    .select({ id: customDomains.id, workspaceId: customDomains.workspaceId })
    .from(customDomains)
    .where(eq(customDomains.domain, domain))
    .limit(1)
  if (taken) {
    return {
      success: false,
      error:
        taken.workspaceId === workspace.id
          ? "You've already added that domain."
          : "That domain is already in use.",
    }
  }

  try {
    const { verified, verification } = await vercelAddDomain(domain)
    await db.insert(customDomains).values({
      workspaceId: workspace.id,
      domain,
      status: verified ? "active" : "pending",
      verification,
    })
  } catch (err) {
    console.error("[addCustomDomain] failed", err)
    const message = (err as Error).message || "Couldn't add the domain. Please try again."
    return { success: false, error: message }
  }

  revalidatePath("/domains")
  return { success: true }
}

/** Re-check a pending domain against Vercel and flip it to active when ready. */
export async function checkCustomDomain(id: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .select()
    .from(customDomains)
    .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, workspace.id)))
    .limit(1)
  if (!row) return { success: false, error: "Domain not found" }

  try {
    const status = await vercelGetDomainStatus(row.domain)
    const active = status.verified && !status.misconfigured
    await db
      .update(customDomains)
      .set({
        status: active ? "active" : "pending",
        verification: status.verification,
        lastCheckedAt: new Date(),
      })
      .where(eq(customDomains.id, id))
  } catch (err) {
    console.error("[checkCustomDomain] failed", err)
    return { success: false, error: "Couldn't check the domain. Please try again." }
  }

  revalidatePath("/domains")
  return { success: true }
}

/** Remove a domain from Vercel and the workspace (forms fall back to /f links). */
export async function removeCustomDomain(id: string): Promise<Result> {
  const workspace = await getDefaultWorkspace()
  if (!workspace) return { success: false, error: "No workspace" }

  const [row] = await db
    .select()
    .from(customDomains)
    .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, workspace.id)))
    .limit(1)
  if (!row) return { success: false, error: "Domain not found" }

  try {
    await vercelRemoveDomain(row.domain)
  } catch (err) {
    console.error("[removeCustomDomain] vercel removal failed", err)
    return { success: false, error: "Couldn't remove the domain from the host. Please try again." }
  }

  // FK is ON DELETE SET NULL, so any forms on this domain revert to /f links.
  await db.delete(customDomains).where(eq(customDomains.id, id))

  revalidatePath("/domains")
  return { success: true }
}
