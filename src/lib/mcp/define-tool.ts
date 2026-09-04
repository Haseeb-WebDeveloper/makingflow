import "server-only"

/**
 * The one way an MCP tool gets defined.
 *
 * Everything a tool needs in order to be safe is a REQUIRED field here, so the
 * mistake is a compile error rather than a review catch:
 *
 *   - `scopes` is typed `readonly [Scope, ...Scope[]]` — a non-empty tuple. A
 *     tool cannot be registered without declaring what it needs, and `[]` does
 *     not type-check.
 *   - `destructive: true` adds the `destructive` scope AND a required
 *     `confirm: true` argument. Two independent gates, because they stop
 *     different things: the scope constrains the KEY (this credential was never
 *     meant to delete anything), while confirm constrains the MODEL (the user
 *     said something vague and deletion is not recoverable).
 *   - `action` reuses the existing OWNER_ONLY table via `authorize()`, so role
 *     rules are identical for a browser and an API key. A member's key holding
 *     `team:write` still cannot invite anyone.
 *
 * Scope checks live here rather than in `src/lib/core/**` because a scope is a
 * property of a delegated credential, and the web app has none — core is shared
 * with it. They do not live in the route either, which cannot know which tool
 * was called without a name→scopes map that would drift on the first hurried
 * addition.
 */

import * as z from "zod"
import { authorize, type AuthContext, type Scope } from "@/lib/auth/context"
import type { WorkspaceAction } from "@/lib/auth/permissions"

/**
 * A failure the CALLER should see in full: "Form not found", "That folder
 * belongs to another workspace", "This form is already published".
 *
 * The distinction matters because the two kinds of failure want opposite
 * handling. An unexpected exception may carry connection strings, row contents
 * or stack detail, and it goes to a third-party model — so it is flattened to a
 * generic message and the real one is logged. But a business outcome is
 * information the model NEEDS: told only "the operation failed", it cannot tell
 * a wrong id from a broken server, and will retry something that will never
 * work. Throwing this type says "this message is safe and useful".
 *
 * Note that "not found" and "belongs to another tenant" must stay
 * indistinguishable — the core layer already collapses them, and this type
 * carries that decision outward unchanged.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ToolError"
  }
}

/** A tool's failure modes, kept apart because the model reacts differently. */
export type ToolFailure =
  | { ok: false; code: "forbidden"; error: string }
  | { ok: false; code: "needs_confirmation"; error: string }
  | { ok: false; code: "invalid"; error: string }
  | { ok: false; code: "failed"; error: string }

export type ToolOutcome<T> = { ok: true; result: T } | ToolFailure

export type ToolDefinition<Input extends z.ZodObject, Output extends z.ZodType> = {
  /**
   * Prefixed `makingflow_`. Tool-name uniqueness is only guaranteed within one
   * server, and aggregating clients are told to disambiguate but cannot rely on
   * `serverInfo.name` to do it — so we namespace ourselves rather than hope.
   */
  name: `makingflow_${string}`
  title: string
  description: string
  inputSchema: Input
  outputSchema: Output
  /** Non-empty by construction. */
  scopes: readonly [Scope, ...Scope[]]
  /** Owner-only actions, checked against the same OWNER_ONLY table as the web. */
  action?: WorkspaceAction
  /** Irreversible. Adds the `destructive` scope and a required confirm flag. */
  destructive?: true
  /** True for tools that only read — surfaced to clients as `readOnlyHint`. */
  readOnly?: boolean
  /** Repeating the call leaves the same state — surfaced as `idempotentHint`. */
  idempotent?: boolean
  handler: (ctx: AuthContext, args: z.infer<Input>) => Promise<z.infer<Output>>
}

export type RegisteredMcpTool = {
  name: string
  title: string
  description: string
  inputSchema: z.ZodObject
  outputSchema: z.ZodType
  scopes: readonly Scope[]
  readOnly: boolean
  destructive: boolean
  idempotent: boolean
  /** Everything a caller may reach. There is no path to `handler` that skips this. */
  run: (ctx: AuthContext, rawArgs: unknown) => Promise<ToolOutcome<unknown>>
}

const CONFIRM_FIELD = "confirm"

export function defineTool<Input extends z.ZodObject, Output extends z.ZodType>(
  def: ToolDefinition<Input, Output>,
): RegisteredMcpTool {
  const scopes: readonly Scope[] = def.destructive
    ? [...def.scopes, "destructive" as const]
    : def.scopes

  // A destructive tool ADVERTISES the confirm requirement in its schema, so a
  // model can see it before calling rather than discovering it from an error.
  const schema = def.destructive
    ? def.inputSchema.extend({
        [CONFIRM_FIELD]: z
          .literal(true)
          .describe("Must be true. This permanently deletes data and cannot be undone."),
      })
    : def.inputSchema

  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: schema,
    outputSchema: def.outputSchema,
    scopes,
    readOnly: def.readOnly ?? false,
    destructive: def.destructive ?? false,
    idempotent: def.idempotent ?? false,

    async run(ctx, rawArgs) {
      const denied = authorize(ctx, { scopes, action: def.action })
      if (denied) return { ok: false, code: "forbidden", error: denied }

      const parsed = schema.safeParse(rawArgs ?? {})
      if (!parsed.success) {
        // Distinguish "you forgot to confirm" from "your arguments are wrong",
        // because the first is recoverable by the model re-issuing the call and
        // the second usually is not.
        const missingConfirm =
          def.destructive && parsed.error.issues.some((i) => i.path[0] === CONFIRM_FIELD)
        return missingConfirm
          ? {
              ok: false,
              code: "needs_confirmation",
              error: `${def.name} permanently deletes data and cannot be undone. Confirm with the user, then call again with confirm: true.`,
            }
          : {
              ok: false,
              code: "invalid",
              error: z.prettifyError(parsed.error),
            }
      }

      try {
        return { ok: true, result: await def.handler(ctx, parsed.data as z.infer<Input>) }
      } catch (error) {
        // A deliberate business outcome — safe to pass through, and the model
        // needs it to correct itself.
        if (error instanceof ToolError) {
          return { ok: false, code: "failed", error: error.message }
        }
        // Anything else is unexpected and may carry internals. Log the real
        // thing; tell the model only that it failed.
        console.error(`[mcp] ${def.name} failed`, error)
        return { ok: false, code: "failed", error: "The operation failed. Please try again." }
      }
    },
  }
}
