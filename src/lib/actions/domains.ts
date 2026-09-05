"use server"

/**
 * Custom-domain Server Actions. Logic lives in src/lib/core/domains.ts, shared
 * with the MCP surface.
 *
 * Note that adding a domain cannot complete headlessly: it registers with
 * Vercel and returns DNS challenges the human must create at their registrar.
 * `checkCustomDomain` is the poll that succeeds once they have.
 */

import { sessionContext } from "@/lib/auth/context-web"
import * as domainsCore from "@/lib/core/domains"

type Result = { success: true } | { success: false; error: string }

/** Register a custom domain for the workspace and return its DNS challenges. */
export async function addCustomDomain(rawDomain: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return domainsCore.addCustomDomain(session.ctx, rawDomain)
}

/** Attach a form to a domain at a path, or clear it back to /f/[publicId]. */
export async function setFormDomain(
  formId: string,
  input: { customDomainId: string | null; slug: string | null },
): Promise<
  { success: true; domain: string | null; slug: string | null } | { success: false; error: string }
> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return domainsCore.setFormDomain(session.ctx, formId, input)
}

/** Re-check a pending domain against Vercel and flip it to active when ready. */
export async function checkCustomDomain(id: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return domainsCore.checkCustomDomain(session.ctx, id)
}

/** Remove a custom domain; forms on it revert to their /f links. */
export async function removeCustomDomain(id: string): Promise<Result> {
  const session = await sessionContext()
  if (!session.ok) return { success: false, error: session.error }
  return domainsCore.removeCustomDomain(session.ctx, id)
}
