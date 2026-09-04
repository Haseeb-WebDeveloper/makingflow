import "server-only"

/**
 * The MCP tool registry — the ONLY path from the transport to a handler.
 *
 * `src/app/api/mcp/route.ts` looks a tool up here and calls `run()`. There is
 * no other way in, which is what makes the scope and confirm gates in
 * `defineTool` unskippable rather than merely conventional.
 *
 * This first slice is deliberately four tools over the forms core. It exists to
 * prove the riskiest assumption in the design end to end — that a write issued
 * through a Route Handler really does flush the caches the public form runtime
 * reads from — before the remaining twenty-odd tools are built on top of it.
 */

import * as z from "zod"
import { getFormForEdit, getWorkspaceForms } from "@/lib/data/forms"
import * as formsCore from "@/lib/core/forms"
import { defineTool, ToolError, type RegisteredMcpTool } from "@/lib/mcp/define-tool"
import type { Budget } from "@/lib/mcp/rate-limit"

/** Which budget a tool draws from. Reads are cheap; writes and AI are not. */
export const TOOL_BUDGET: Record<string, Budget> = {}

const formSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  publicId: z.string(),
  folderId: z.string().nullable(),
  updatedAt: z.string(),
})

export const TOOLS: readonly RegisteredMcpTool[] = [
  defineTool({
    name: "makingflow_list_forms",
    title: "List forms",
    description:
      "List the forms in this workspace, most recently updated first. Returns a summary of each — use makingflow_get_form for a form's full definition.",
    inputSchema: z.object({
      status: z
        .enum(["draft", "published", "closed", "archived"])
        .optional()
        .describe("Only return forms with this status."),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    outputSchema: z.object({
      forms: z.array(formSummary),
      total: z.number().int(),
    }),
    scopes: ["forms:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx, args) {
      const rows = await getWorkspaceForms(ctx.workspaceId)
      const filtered = args.status ? rows.filter((r) => r.status === args.status) : rows
      return {
        forms: filtered.slice(0, args.limit).map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          publicId: r.publicId,
          folderId: r.folderId,
          updatedAt: r.updatedAt.toISOString(),
        })),
        total: filtered.length,
      }
    },
  }),

  defineTool({
    name: "makingflow_get_form",
    title: "Get a form",
    description:
      "Fetch one form's full definition: its fields in order, their options, conditional logic, settings and theme. This is the shape you edit and save back.",
    inputSchema: z.object({
      formId: z.string().describe("The form's id, from makingflow_list_forms."),
    }),
    outputSchema: z.object({
      id: z.string(),
      status: z.string(),
      publicId: z.string(),
      shareUrl: z.string().nullable(),
      form: z.unknown().describe("The form definition: title, fields, settings, theme."),
    }),
    scopes: ["forms:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx, args) {
      const data = await getFormForEdit(args.formId, ctx.workspaceId)
      // Indistinguishable from another tenant's form, deliberately.
      if (!data) throw new ToolError("Form not found")
      const base = process.env.NEXT_PUBLIC_SITE_URL
      return {
        id: data.id,
        status: data.status,
        publicId: data.publicId,
        shareUrl:
          data.status === "published" && base ? `${base}/f/${data.publicId}` : null,
        form: data.form,
      }
    },
  }),

  defineTool({
    name: "makingflow_rename_form",
    title: "Rename a form",
    description:
      "Change a form's title. The title is shown to respondents on the public form as well as in the dashboard.",
    inputSchema: z.object({
      formId: z.string(),
      title: z.string().min(1).max(200),
    }),
    outputSchema: z.object({ ok: z.boolean(), title: z.string() }),
    scopes: ["forms:write"],
    idempotent: true,
    async handler(ctx, args) {
      const result = await formsCore.renameForm(ctx, args.formId, args.title)
      if (!result.success) throw new ToolError(result.error ?? "Rename failed")
      return { ok: true, title: args.title.trim().slice(0, 200) }
    },
  }),

  defineTool({
    name: "makingflow_publish_form",
    title: "Publish or unpublish a form",
    description:
      "Take a form live at its public link, or take it back offline as a draft. A published form starts accepting responses immediately.",
    inputSchema: z.object({
      formId: z.string(),
      published: z
        .boolean()
        .default(true)
        .describe("true publishes the form; false returns it to draft."),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.string(),
      shareUrl: z.string().nullable(),
    }),
    scopes: ["forms:write"],
    idempotent: true,
    async handler(ctx, args) {
      if (!args.published) {
        const result = await formsCore.unpublishForm(ctx, args.formId)
        if (!result.success) throw new ToolError(result.error ?? "Could not unpublish")
        return { ok: true, status: "draft", shareUrl: null }
      }
      const result = await formsCore.publishForm(ctx, args.formId)
      if (!result.success) throw new ToolError(result.error)
      const base = process.env.NEXT_PUBLIC_SITE_URL
      return {
        ok: true,
        status: "published",
        shareUrl: base ? `${base}/f/${result.publicId}` : null,
      }
    },
  }),
]

export const TOOLS_BY_NAME: ReadonlyMap<string, RegisteredMcpTool> = new Map(
  TOOLS.map((tool) => [tool.name, tool]),
)

/** Read-only tools draw on the cheap budget; everything else is a write. */
export function budgetFor(tool: RegisteredMcpTool): Budget {
  return TOOL_BUDGET[tool.name] ?? (tool.readOnly ? "read" : "write")
}
