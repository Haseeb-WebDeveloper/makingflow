import "server-only"

import type { DomainVerification } from "@/lib/db/schema"

/**
 * Thin wrapper over the Vercel Domains API. Custom domains are registered on
 * OUR Vercel project; Vercel routes their traffic to us and auto-issues SSL.
 *
 * Requires (server-only):
 *   VERCEL_TOKEN       — API token scoped to the team that owns the project
 *   VERCEL_PROJECT_ID  — the project that serves this app
 *   VERCEL_TEAM_ID     — only if the project lives under a team
 */

const API = "https://api.vercel.com"

/** DNS target a subdomain CNAME should point at. */
export const VERCEL_CNAME_TARGET = "cname.vercel-dns.com"

export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID)
}

function creds() {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !projectId) throw new Error("VERCEL_TOKEN / VERCEL_PROJECT_ID not set")
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID }
}

/** Append ?teamId= when the project is team-owned. */
function withTeam(path: string, teamId?: string): string {
  if (!teamId) return `${API}${path}`
  const sep = path.includes("?") ? "&" : "?"
  return `${API}${path}${sep}teamId=${encodeURIComponent(teamId)}`
}

async function vercelFetch(path: string, init: RequestInit, teamId?: string) {
  const { token } = creds()
  const res = await fetch(withTeam(path, teamId), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const message = body?.error?.message || `Vercel API ${res.status}`
    const err = new Error(message) as Error & { code?: string; status?: number }
    err.code = body?.error?.code
    err.status = res.status
    throw err
  }
  return body
}

export type VercelDomainStatus = {
  verified: boolean
  misconfigured: boolean
  verification: DomainVerification[]
}

/** Register a domain on the project. Returns its initial verification state. */
export async function vercelAddDomain(domain: string): Promise<{
  verified: boolean
  verification: DomainVerification[]
}> {
  const { projectId, teamId } = creds()
  const body = await vercelFetch(
    `/v10/projects/${projectId}/domains`,
    { method: "POST", body: JSON.stringify({ name: domain }) },
    teamId,
  )
  return { verified: Boolean(body.verified), verification: body.verification ?? [] }
}

/** Remove a domain from the project. Treats "not found" as success (idempotent). */
export async function vercelRemoveDomain(domain: string): Promise<void> {
  const { projectId, teamId } = creds()
  try {
    await vercelFetch(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
      { method: "DELETE" },
      teamId,
    )
  } catch (err) {
    if ((err as { status?: number }).status === 404) return
    throw err
  }
}

/**
 * Current state of a domain: whether Vercel has verified ownership and whether
 * DNS still points somewhere wrong. Active = verified && !misconfigured.
 */
export async function vercelGetDomainStatus(domain: string): Promise<VercelDomainStatus> {
  const { projectId, teamId } = creds()
  const [projectDomain, config] = await Promise.all([
    vercelFetch(
      `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
      { method: "GET" },
      teamId,
    ),
    vercelFetch(`/v6/domains/${encodeURIComponent(domain)}/config`, { method: "GET" }, teamId),
  ])
  return {
    verified: Boolean(projectDomain.verified),
    misconfigured: Boolean(config.misconfigured),
    verification: projectDomain.verification ?? [],
  }
}
