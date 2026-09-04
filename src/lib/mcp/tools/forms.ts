import "server-only"

/**
 * Form tools.
 *
 * THE DESIGN DECISION WORTH KNOWING ABOUT is `makingflow_update_form`.
 *
 * The app has `aiEditForm()`, which turns a plain-language instruction into
 * operations using DeepSeek and applies them. It would have been the obvious
 * thing to expose. It is the wrong thing: the client connecting over MCP is
 * ALREADY a language model. Routing its request through a second model to
 * re-derive operations loses fidelity at the hand-off and bills the workspace
 * for AI it did not need.
 *
 * So this exposes the operation language itself — the same 15 ops, validated by
 * the same `aiOperationSchema`, applied by the same deterministic
 * `applyOperations()` the builder uses, persisted by the same core. The
 * connected model emits ops directly.
 *
 * A useful consequence: the MCP surface has no AI dependency in its core loop,
 * which matches the product rule that AI must degrade gracefully.
 */

import * as z from "zod"
import { getFormForEdit, getWorkspaceForms } from "@/lib/data/forms"
import { getWorkspaceFolders } from "@/lib/data/folders"
import * as formsCore from "@/lib/core/forms"
import * as foldersCore from "@/lib/core/folders"
import { aiOperationSchema, AI_FIELD_TYPES, AI_OP_NAMES } from "@/lib/ai/form-schema"
import { applyOperations, type EditorForm } from "@/lib/builder/form-model"
import { LOGIC_OPERATORS } from "@/lib/builder/logic"
import { defineTool, ToolError, type RegisteredMcpTool } from "@/lib/mcp/define-tool"

const formSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  publicId: z.string(),
  folderId: z.string().nullable(),
  updatedAt: z.string(),
})

function shareUrl(publicId: string, status: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL
  return status === "published" && base ? `${base}/f/${publicId}` : null
}

/** Load a form the caller owns, or fail the way every other lookup does. */
async function loadForm(workspaceId: string, formId: string) {
  const data = await getFormForEdit(formId, workspaceId)
  // "Not found" and "belongs to another workspace" are deliberately the same
  // answer — the API must not confirm the existence of what you cannot see.
  if (!data) throw new ToolError("Form not found")
  return data
}

export const formTools: RegisteredMcpTool[] = [
  defineTool({
    name: "makingflow_get_context",
    title: "Get workspace context",
    description:
      "Start here. Returns this workspace's identity and plan, its folders, and the vocabulary the other tools accept: valid field types, edit operations and logic operators. Call this once before building or editing a form so you are not guessing at names.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      workspace: z.object({
        id: z.string(),
        name: z.string(),
        plan: z.string(),
        role: z.string(),
      }),
      folders: z.array(z.object({ id: z.string(), name: z.string() })),
      capabilities: z.object({
        fieldTypes: z.array(z.string()),
        operations: z.array(z.string()),
        logicOperators: z.array(z.string()),
      }),
    }),
    scopes: ["forms:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx) {
      return {
        workspace: {
          id: ctx.workspaceId,
          name: ctx.workspaceName,
          plan: ctx.plan,
          role: ctx.role,
        },
        folders: await getWorkspaceFolders(ctx.workspaceId),
        capabilities: {
          fieldTypes: [...AI_FIELD_TYPES],
          operations: [...AI_OP_NAMES],
          logicOperators: LOGIC_OPERATORS.map((o) => o.value),
        },
      }
    },
  }),

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
      folderId: z.string().optional().describe("Only return forms filed in this folder."),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    outputSchema: z.object({ forms: z.array(formSummary), total: z.number().int() }),
    scopes: ["forms:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx, args) {
      const rows = await getWorkspaceForms(ctx.workspaceId)
      const filtered = rows.filter(
        (r) =>
          (!args.status || r.status === args.status) &&
          (!args.folderId || r.folderId === args.folderId),
      )
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
      "Fetch one form's full definition: its fields in order with their ids, options, conditional logic, settings and theme. Field ids from here are what makingflow_update_form operations target.",
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
      const data = await loadForm(ctx.workspaceId, args.formId)
      return {
        id: data.id,
        status: data.status,
        publicId: data.publicId,
        shareUrl: shareUrl(data.publicId, data.status),
        form: data.form,
      }
    },
  }),

  defineTool({
    name: "makingflow_create_form",
    title: "Create a form",
    description:
      "Create a new draft form. Supply the fields you want; the form starts as a draft and collects nothing until makingflow_publish_form is called. Use makingflow_get_context first for the valid field types.",
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      fields: z
        .array(
          z.object({
            type: z.enum(AI_FIELD_TYPES),
            label: z.string(),
            description: z.string().optional(),
            placeholder: z.string().optional(),
            required: z.boolean().optional(),
            options: z
              .array(z.string())
              .optional()
              .describe("Choice options. Required for choice field types."),
          }),
        )
        .default([]),
      folderId: z.string().optional(),
    }),
    outputSchema: z.object({ id: z.string(), title: z.string(), status: z.string() }),
    scopes: ["forms:write"],
    async handler(ctx, args) {
      const form: EditorForm = {
        title: args.title,
        fields: args.fields.map((f) => ({
          id: crypto.randomUUID(),
          type: f.type,
          label: f.label,
          description: f.description,
          placeholder: f.placeholder,
          required: f.required ?? false,
          options: f.options?.map((label) => ({ id: crypto.randomUUID(), label })),
        })),
      }
      const saved = await formsCore.saveAiForm(ctx, { form })
      if (!saved.success) throw new ToolError(saved.error)
      if (args.folderId) {
        const moved = await foldersCore.moveFormToFolder(ctx, saved.id, args.folderId)
        if (!moved.success) throw new ToolError(moved.error)
      }
      return { id: saved.id, title: args.title, status: "draft" }
    },
  }),

  defineTool({
    name: "makingflow_update_form",
    title: "Edit a form",
    description: [
      "Change an existing form by applying a list of operations to it.",
      "",
      "Fetch the form with makingflow_get_form first: operations target fields by their id, and options by their id or exact label.",
      "Operations apply in order, deterministically. An operation whose target cannot be resolved is skipped rather than guessed at, so check the returned form to confirm what landed.",
      "",
      `Available operations: ${AI_OP_NAMES.join(", ")}.`,
    ].join("\n"),
    inputSchema: z.object({
      formId: z.string(),
      operations: z.array(aiOperationSchema).min(1),
    }),
    outputSchema: z.object({
      id: z.string(),
      applied: z.number().int(),
      form: z.unknown().describe("The form as it now stands, after the operations."),
    }),
    scopes: ["forms:write"],
    async handler(ctx, args) {
      const current = await loadForm(ctx.workspaceId, args.formId)
      // The same deterministic interpreter the builder uses. No model involved:
      // the caller is one already.
      const next = applyOperations(current.form, args.operations)
      const saved = await formsCore.saveAiForm(ctx, { formId: args.formId, form: next })
      if (!saved.success) throw new ToolError(saved.error)
      return { id: args.formId, applied: args.operations.length, form: next }
    },
  }),

  defineTool({
    name: "makingflow_update_form_settings",
    title: "Update form settings",
    description:
      "Change how a form collects responses: its closing rules, response cap, redirect, success page, render mode and AI behaviour. Only the fields you send are changed.",
    inputSchema: z.object({
      formId: z.string(),
      closed: z.boolean().optional().describe("Close or reopen a published form."),
      submissionLimit: z.number().int().positive().nullable().optional(),
      closesAt: z.string().nullable().optional().describe("ISO timestamp, or null to clear."),
      redirectUrl: z.string().nullable().optional(),
      oneResponsePerPerson: z.boolean().optional(),
      showProgressBar: z.boolean().optional(),
      submitButtonLabel: z.string().nullable().optional(),
      thankYouMessage: z.string().nullable().optional(),
      renderMode: z
        .enum(["classic", "conversational"])
        .optional()
        .describe("Conversational mode requires AI and turns it on automatically."),
      persona: z.string().nullable().optional(),
      followUpsEnabled: z.boolean().optional(),
      clarifyVagueAnswers: z.boolean().optional(),
      summaryEnabled: z.boolean().optional(),
      screeningEnabled: z.boolean().optional(),
      screeningCriteria: z.string().nullable().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    scopes: ["forms:write"],
    idempotent: true,
    async handler(ctx, args) {
      const { formId, ...patch } = args
      const result = await formsCore.updateFormSettings(ctx, formId, patch)
      if (!result.success) throw new ToolError(result.error ?? "Could not update settings")
      return { ok: true }
    },
  }),

  defineTool({
    name: "makingflow_publish_form",
    title: "Publish or unpublish a form",
    description:
      "Take a form live at its public link, or take it back offline as a draft. A published form starts accepting responses immediately.",
    inputSchema: z.object({
      formId: z.string(),
      published: z.boolean().default(true).describe("true publishes; false returns it to draft."),
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

  defineTool({
    name: "makingflow_rename_form",
    title: "Rename a form",
    description:
      "Change a form's title. The title is shown to respondents on the public form as well as in the dashboard.",
    inputSchema: z.object({ formId: z.string(), title: z.string().min(1).max(200) }),
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
    name: "makingflow_duplicate_form",
    title: "Duplicate a form",
    description:
      "Copy a form and its fields into a new draft. The copy gets its own public link and never inherits the original's responses or live status.",
    inputSchema: z.object({ formId: z.string() }),
    outputSchema: z.object({ id: z.string() }),
    scopes: ["forms:write"],
    async handler(ctx, args) {
      const result = await formsCore.duplicateForm(ctx, args.formId)
      if (!result.success || !result.id) throw new ToolError(result.error ?? "Could not duplicate")
      return { id: result.id }
    },
  }),

  defineTool({
    name: "makingflow_delete_form",
    title: "Delete a form",
    description:
      "PERMANENTLY delete a form and EVERY response to it, including uploaded files. This cascades to submissions, answers and analytics, and there is no undo or trash. Confirm with the user before calling. To take a form offline without losing data, use makingflow_publish_form with published: false instead.",
    inputSchema: z.object({ formId: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    scopes: ["forms:write"],
    destructive: true,
    async handler(ctx, args) {
      const result = await formsCore.deleteForm(ctx, args.formId)
      if (!result.success) throw new ToolError(result.error ?? "Could not delete the form")
      return { ok: true }
    },
  }),

  defineTool({
    name: "makingflow_manage_folder",
    title: "Create, rename or delete a folder",
    description:
      "Organise forms into folders. Deleting a folder never deletes its forms — they fall back to uncategorised.",
    inputSchema: z.object({
      action: z.enum(["create", "rename", "delete"]),
      folderId: z.string().optional().describe("Required for rename and delete."),
      name: z.string().min(1).max(100).optional().describe("Required for create and rename."),
    }),
    outputSchema: z.object({ ok: z.boolean(), folderId: z.string().nullable() }),
    scopes: ["forms:write"],
    async handler(ctx, args) {
      if (args.action === "create") {
        if (!args.name) throw new ToolError("A folder name is required to create one.")
        const created = await foldersCore.createFolder(ctx, args.name)
        if (!created.success) throw new ToolError(created.error)
        return { ok: true, folderId: created.id }
      }
      if (!args.folderId) throw new ToolError(`folderId is required to ${args.action} a folder.`)
      if (args.action === "rename") {
        if (!args.name) throw new ToolError("A new name is required to rename a folder.")
        const renamed = await foldersCore.renameFolder(ctx, args.folderId, args.name)
        if (!renamed.success) throw new ToolError(renamed.error)
        return { ok: true, folderId: args.folderId }
      }
      const deleted = await foldersCore.deleteFolder(ctx, args.folderId)
      if (!deleted.success) throw new ToolError(deleted.error)
      return { ok: true, folderId: null }
    },
  }),

  defineTool({
    name: "makingflow_move_form",
    title: "Move a form into a folder",
    description: "File a form under a folder, or pass folderId: null to take it out of all folders.",
    inputSchema: z.object({ formId: z.string(), folderId: z.string().nullable() }),
    outputSchema: z.object({ ok: z.boolean() }),
    scopes: ["forms:write"],
    idempotent: true,
    async handler(ctx, args) {
      const result = await foldersCore.moveFormToFolder(ctx, args.formId, args.folderId)
      if (!result.success) throw new ToolError(result.error)
      return { ok: true }
    },
  }),
]
