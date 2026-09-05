import { and, eq, isNull, ne } from "drizzle-orm"
import { db } from "@/lib/db"
import { customDomains, forms } from "@/lib/db/schema"
import type { AuthContext } from "@/lib/auth/context"
import { invalidate } from "@/lib/core/cache"
import { slugify } from "@/lib/forms/share"
import {
  isVercelConfigured,
  vercelAddDomain,
  vercelGetDomainStatus,
  vercelRemoveDomain,
} from "@/lib/domains/vercel"
import { normalizeHost } from "@/lib/domains/host"

type Result = { success: true } | { success: false; error: string }

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
export async function addCustomDomain(ctx: AuthContext, rawDomain: string): Promise<Result> {
  if (!isVercelConfigured()) {
    return { success: false, error: "Custom domains aren't configured on this deployment yet." }
  }

  const domain = normalizeHost(rawDomain)
  if (!domain) return { success: false, error: "Enter a domain." }
  if (!isValidSubdomain(domain)) {
    return {
      success: false,
      error: "Use a subdomain like forms.yourbrand.com (root domains aren't supported yet).",
    }
  }

  const rootDomain = normalizeHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "")
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
        taken.workspaceId === ctx.workspaceId
          ? "You've already added that domain."
          : "That domain is already in use.",
    }
  }

  try {
    const { verified, verification } = await vercelAddDomain(domain)
    await db.insert(customDomains).values({
      workspaceId: ctx.workspaceId,
      domain,
      status: verified ? "active" : "pending",
      verification,
    })
  } catch (err) {
    console.error("[addCustomDomain] failed", err)
    const message = (err as Error).message || "Couldn't add the domain. Please try again."
    return { success: false, error: message }
  }

  invalidate(ctx, {
    tags: [`workspace-domains-${ctx.workspaceId}`],
    paths: ["/domains"],
  })
  return { success: true }
}

type SetDomainResult =
  | { success: true; domain: string | null; slug: string | null }
  | { success: false; error: string }

/**
 * Attach a form to a custom domain at a slug (team.acme.com/{slug}), or clear it
 * back to the default /f link. Workspace-scoped; the domain must be active and
 * the slug unique on that domain.
 */
export async function setFormDomain(
  ctx: AuthContext,
  formId: string,
  input: { customDomainId: string | null; slug: string | null },
): Promise<SetDomainResult> {

  // Read the CURRENT host+slug too, so we can invalidate the public cache the
  // form is moving away from (otherwise the old slug keeps serving this form).
  const [form] = await db
    .select({ id: forms.id, slug: forms.slug, oldHost: customDomains.domain })
    .from(forms)
    .leftJoin(customDomains, eq(customDomains.id, forms.customDomainId))
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, ctx.workspaceId), isNull(forms.deletedAt)))
    .limit(1)
  if (!form) return { success: false, error: "Form not found" }

  // The form's shell shows its domain, and the OLD host's public cache must go
  // too or the form keeps answering on the address it just moved off.
  const formTags = () => {
    const tags = [`form-${formId}`]
    if (form.oldHost && form.slug) {
      tags.push(`form-domain-${form.oldHost.toLowerCase()}-${form.slug}`)
    }
    return tags
  }

  // Clear — revert to the default /f/{publicId} link.
  if (!input.customDomainId) {
    await db.update(forms).set({ customDomainId: null, slug: null }).where(eq(forms.id, formId))
    invalidate(ctx, {
      tags: formTags(),
      paths: [{ path: `/forms/${formId}`, type: "layout" }, "/domains"],
    })
    return { success: true, domain: null, slug: null }
  }

  const [dom] = await db
    .select({ id: customDomains.id, domain: customDomains.domain })
    .from(customDomains)
    .where(
      and(
        eq(customDomains.id, input.customDomainId),
        eq(customDomains.workspaceId, ctx.workspaceId),
        eq(customDomains.status, "active"),
      ),
    )
    .limit(1)
  if (!dom) return { success: false, error: "That domain isn't available." }

  const slug = slugify(input.slug ?? "")
  if (!slug) return { success: false, error: "Enter a path for the form (e.g. feedback)." }

  // No two forms may share a slug on the same domain.
  const [clash] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(
      and(
        eq(forms.customDomainId, dom.id),
        eq(forms.slug, slug),
        ne(forms.id, formId),
        isNull(forms.deletedAt),
      ),
    )
    .limit(1)
  if (clash) return { success: false, error: `"${slug}" is already used on ${dom.domain}.` }

  try {
    await db.update(forms).set({ customDomainId: dom.id, slug }).where(eq(forms.id, formId))
  } catch (err) {
    console.error("[setFormDomain] failed", err)
    return { success: false, error: "Couldn't save. Try a different path." }
  }

  invalidate(ctx, {
    tags: formTags(),
    paths: [{ path: `/forms/${formId}`, type: "layout" }, "/domains"],
  })
  return { success: true, domain: dom.domain, slug }
}

/** Re-check a pending domain against Vercel and flip it to active when ready. */
export async function checkCustomDomain(ctx: AuthContext, id: string): Promise<Result> {

  const [row] = await db
    .select()
    .from(customDomains)
    .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, ctx.workspaceId)))
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

  // A domain may have flipped to active.
  invalidate(ctx, {
    tags: [`workspace-domains-${ctx.workspaceId}`],
    paths: ["/domains"],
  })
  return { success: true }
}

/** Remove a domain from Vercel and the workspace (forms fall back to /f links). */
export async function removeCustomDomain(ctx: AuthContext, id: string): Promise<Result> {

  const [row] = await db
    .select()
    .from(customDomains)
    .where(and(eq(customDomains.id, id), eq(customDomains.workspaceId, ctx.workspaceId)))
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

  // Forms that were on this domain revert to /f links; their cached shells and
  // public domain caches self-heal within cacheLife('minutes').
  invalidate(ctx, {
    tags: [`workspace-domains-${ctx.workspaceId}`],
    paths: ["/domains"],
  })
  return { success: true }
}
