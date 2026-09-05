/**
 * The caller, resolved — whoever they are and however they got here.
 *
 * Every tenant-scoped operation takes one of these as its first argument. It is
 * the ONLY source of tenancy in `src/lib/core/**`: a core function never asks
 * who is calling, it is told. That is what lets one implementation serve both
 * the browser (cookie session) and the MCP server (API key), and what makes a
 * cross-tenant read a visible mistake at the call site rather than an invisible
 * one buried in an ambient lookup.
 *
 * WHY THIS TYPE IS SEALED
 *
 * `src/lib/actions/*.ts` are file-level `"use server"`, so every export there is
 * a network-reachable RPC endpoint whose arguments are deserialized from a
 * browser POST. If an AuthContext could be built from an object literal, then
 * ANY route or action that accepted one as a parameter would be accepting
 * client-supplied tenancy — a caller could simply post
 * `{ workspaceId: "<someone else's>", role: "owner" }` and be obeyed.
 *
 * So the type carries a property keyed by a `unique symbol` that this module
 * does not export. No other module can produce a value of this type; TypeScript
 * rejects the literal. `unsafeSealContext` is the only constructor, and lint
 * confines it to the producer modules listed below. Fabricating a context out of
 * request input is therefore a compile error, not a code-review catch.
 *
 * Producers (each returns the same result shape, so adding one changes nothing
 * else):
 *   - `src/lib/auth/context-web.ts`  → cookie session
 *   - `src/lib/mcp/auth.ts`          → API key bearer token
 */

// From roles.ts, not permissions.ts: the latter also holds the cookie-bound
// gates, and importing it here would drag next/headers into a module whose
// entire purpose is to be transport-agnostic.
import { can, type WorkspaceAction } from "@/lib/auth/roles"

declare const seal: unique symbol

export type Role = "owner" | "member"

/**
 * What a delegated credential was allowed to do. Scopes exist for API keys; a
 * cookie session holds ALL_SCOPES (see AuthContext.scopes).
 */
export type Scope =
  | "forms:read"
  | "forms:write"
  | "submissions:read"
  | "submissions:write"
  | "analytics:read"
  | "integrations:write"
  | "team:write"
  | "destructive"

export const SCOPES = [
  "forms:read",
  "forms:write",
  "submissions:read",
  "submissions:write",
  "analytics:read",
  "integrations:write",
  "team:write",
  "destructive",
] as const satisfies readonly Scope[]

export const ALL_SCOPES: ReadonlySet<Scope> = Object.freeze(new Set<Scope>(SCOPES))

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value)
}

export type AuthContext = {
  /** The human behind the call. An API key is always bound to its creator, so
   *  `createdById` and audit trails read identically for both origins. */
  readonly userId: string
  readonly workspaceId: string
  readonly workspaceName: string
  /**
   * Read LIVE from `workspace_members` when the context is built — never cached
   * on an API key row, never taken from a JWT. A key minted by an owner who was
   * later demoted or removed must not keep owner powers, and this is what makes
   * that true without a revocation sweep.
   */
  readonly role: Role
  readonly plan: string
  /**
   * ALL_SCOPES for a cookie session. Scopes are *attenuation*, not authority: a
   * session IS the principal, so there is nothing to attenuate. Modelling the
   * session case as `undefined` would force `ctx.scopes?.has(s) ?? true` at
   * every call site — a default-allow expression at a security boundary, which
   * is exactly the shape that rots under refactoring. A real Set keeps every
   * check site the same boring `ctx.scopes.has(s)`.
   */
  readonly scopes: ReadonlySet<Scope>
  /**
   * Session, or delegated.
   *
   * Deliberately two values rather than three, even though a delegated call may
   * arrive on an API key or an OAuth grant. Nothing downstream treats those two
   * differently — both are attenuated credentials that lose reach on a
   * membership change — so splitting them here would put a distinction without a
   * difference in front of every consumer. Which credential it actually was is
   * recorded below, for the audit trail that does care.
   */
  readonly origin: "session" | "api-key"
  /** Set when the call arrived on an API key. Null otherwise. */
  readonly apiKeyId: string | null
  /** Set when the call arrived on an OAuth grant. Null otherwise. */
  readonly grantId: string | null
  /**
   * WHICH KIND OF REQUEST THIS IS RUNNING IN. Not cosmetic — Next.js gates
   * cache invalidation on it.
   *
   * `updateTag()` can ONLY be called from a Server Action; calling it in a
   * Route Handler throws. Route Handlers must use
   * `revalidateTag(tag, { expire: 0 })`, which Next's own docs recommend for
   * "external systems [calling] your Route Handlers [that] require data to
   * expire immediately" — precisely the MCP server.
   *
   * Core mutations invalidate through `src/lib/core/cache.ts`, which dispatches
   * on this field. Making it part of the context (rather than sniffing at
   * runtime) means the caller states the truth once, at the point where it is
   * actually known.
   */
  readonly surface: Surface
  readonly [seal]: true
}

/** Where a core function is executing. See AuthContext.surface. */
export type Surface = "server-action" | "route-handler"

/** What a context producer supplies. The seal is added here, not by the caller. */
export type ContextFields = Omit<AuthContext, typeof seal>

/**
 * The only way to mint an AuthContext.
 *
 * Callable ONLY from a context producer (enforced by `no-restricted-imports` in
 * eslint.config.mjs). If you are reaching for this anywhere else, you are about
 * to trust something you should be verifying — add a producer module instead.
 */
export function unsafeSealContext(fields: ContextFields): AuthContext {
  return fields as AuthContext
}

/** The standard failure shape for a producer. */
export type ContextResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; error: string }

/**
 * The one place the permission rule lives:
 *
 *     effective permission = role ∩ scopes
 *
 * Scopes can only ever NARROW. A member's API key holding `team:write` still
 * cannot invite anyone, because `can()` runs regardless of origin — two
 * independent gates, neither able to override the other.
 *
 * Returns the reason on denial, or null when allowed, so callers can produce the
 * codebase's usual `{ success: false, error }` without throwing.
 */
export function authorize(
  ctx: AuthContext,
  need: { scopes?: readonly Scope[]; action?: WorkspaceAction },
): string | null {
  for (const scope of need.scopes ?? []) {
    if (!ctx.scopes.has(scope)) return `Missing scope: ${scope}`
  }
  if (need.action && !can(ctx.role, need.action)) return "Only owners can do that"
  return null
}
