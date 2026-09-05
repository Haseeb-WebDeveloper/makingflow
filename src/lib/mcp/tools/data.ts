import "server-only"

/**
 * Getting response data out, and getting a Tally form in.
 *
 * Both tools move MORE data than a tool result should carry, and each handles
 * that differently.
 *
 * Export returns a LINK, never the CSV. An export is unbounded — a form with
 * 20,000 responses is megabytes — every cell is respondent PII, and a model
 * handed the whole file will summarise it back, doubling the exposure. The link
 * is signed, expires in fifteen minutes and is bound to the workspace it was
 * minted for; see ../export-token.ts for why each of those matters.
 *
 * Import goes the other way and has the opposite problem: it can create
 * hundreds of rows from one call. It is bounded by the core (2,000 responses per
 * import) and idempotent on Tally's own submission id, so a model that retries
 * after a timeout adds nothing the first call already wrote.
 *
 * THE TALLY API KEY IS INBOUND ONLY. It is never stored — Tally's keys are
 * unscoped, so keeping one would mean holding delete rights over somebody's
 * whole Tally account. It still travels through the model's context to get
 * here, which the description says plainly so a user can decide whether they
 * would rather paste it into the web app.
 */

import * as z from "zod"
import * as importCore from "@/lib/core/import-tally"
import { mintExportToken, EXPORT_TOKEN_TTL_MS } from "@/lib/mcp/export-token"
import { getFormSubmissionCounts } from "@/lib/data/forms"
import { defineTool, ToolError, type RegisteredMcpTool } from "@/lib/mcp/define-tool"

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000"
}

export const dataTools: RegisteredMcpTool[] = [
  defineTool({
    name: "makingflow_export_submissions",
    title: "Export responses as CSV",
    description: [
      "Produce a download link for a form's complete responses as a CSV — every completed response, one row each, one column per question.",
      "",
      "This returns a LINK, not the file. Give it to the user to open. Exports are large and every cell is personal data written by a respondent, so pulling one into this conversation would be both wasteful and a privacy problem. Do not fetch the URL yourself.",
      "The link expires shortly and works only for this form. Call again for a fresh one.",
      "For reading a handful of responses rather than all of them, use makingflow_list_submissions.",
    ].join("\n"),
    inputSchema: z.object({ formId: z.string() }),
    outputSchema: z.object({
      formId: z.string(),
      downloadUrl: z.string().describe("Give this to the user. Do not fetch it."),
      expiresInSeconds: z.number().int(),
      responseCount: z.number().int().describe("Completed responses the file will contain."),
    }),
    scopes: ["submissions:read"],
    readOnly: true,
    async handler(ctx, args) {
      // Resolve the form through the tenancy-checked read BEFORE minting a
      // token for it. Signing an id we never verified would turn this into a
      // way to mint working handles for other tenants' forms.
      const counts = await getFormSubmissionCounts(args.formId, ctx.workspaceId)
      if (!counts) throw new ToolError("Form not found")

      const token = mintExportToken({
        formId: args.formId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
      })

      return {
        formId: args.formId,
        downloadUrl: `${siteUrl()}/api/forms/${args.formId}/export?token=${token}`,
        expiresInSeconds: Math.floor(EXPORT_TOKEN_TTL_MS / 1000),
        responseCount: counts.completed,
      }
    },
  }),

  defineTool({
    name: "makingflow_import_from_tally",
    title: "Import a form from Tally",
    description: [
      "Bring a Tally form into this workspace. Two ways in, depending on what the user has.",
      "",
      "`from_url` needs nothing but a public Tally share link — no Tally account. It rebuilds the questions as a draft. Follow it with `submissions` and the CSV Tally exported to bring the responses across; the CSV joins on question labels, so the form has to exist first.",
      "`list` and `from_api` use a Tally API key, reach private and unpublished forms, and match answers more reliably. `file_into_folders` then recreates the user's Tally workspaces as folders here.",
      "",
      "The API key is used for this one request and never stored — a Tally key can delete the account's forms, so we do not keep one. It does pass through this conversation to reach us; if the user would rather it did not, they can do the same import from the web app.",
      "Imported forms arrive as drafts and accept no responses until published. Importing the same responses twice adds nothing the second time.",
    ].join("\n"),
    inputSchema: z.object({
      operation: z.enum(["from_url", "submissions", "list", "from_api", "file_into_folders"]),
      url: z.string().optional().describe("Required for `from_url`: the public Tally share link."),
      apiKey: z
        .string()
        .optional()
        .describe("Required for `list`, `from_api` and `file_into_folders`."),
      tallyFormId: z.string().optional().describe("Required for `from_api`. From `list`."),
      formId: z.string().optional().describe("Required for `submissions`: the form here to load into."),
      csv: z.string().optional().describe("Required for `submissions`: the CSV Tally exported."),
      withSubmissions: z
        .boolean()
        .default(true)
        .describe("`from_api`: also bring the responses across."),
      startPage: z
        .number()
        .int()
        .optional()
        .describe("`from_api`: continue a large import from the `nextPage` a previous call returned."),
    }),
    outputSchema: z.object({
      operation: z.enum(["from_url", "submissions", "list", "from_api", "file_into_folders"]),
      formId: z.string().nullable().describe("The form created here, when one was."),
      title: z.string().nullable(),
      fieldCount: z.number().int().nullable(),
      skipped: z
        .array(z.object({ type: z.string(), label: z.string() }))
        .describe("Blocks with no equivalent here — payments, signatures. Tell the user."),
      submissions: z
        .object({
          imported: z.number().int(),
          duplicates: z.number().int().describe("Already present from an earlier import."),
          truncated: z.number().int().describe("Beyond the per-import cap. Import again to continue."),
          unmatched: z.array(z.string()).describe("CSV columns that matched no question."),
        })
        .nullable(),
      availableForms: z
        .array(
          z.object({
            tallyFormId: z.string(),
            name: z.string(),
            submissionCount: z.number().int(),
            tallyWorkspace: z.string().nullable(),
          }),
        )
        .describe("Only for `list`."),
      filed: z
        .object({ filed: z.number().int(), alreadyFiled: z.number().int(), folders: z.array(z.string()) })
        .nullable(),
      nextPage: z
        .number()
        .int()
        .nullable()
        .describe(
          "`from_api` only. Not null means responses remain: call again with the same arguments and startPage set to this. Tell the user the import is incomplete until it is null.",
        ),
      responsesError: z
        .string()
        .nullable()
        .describe("`from_api` only. The questions came over but the responses did not."),
      folder: z.string().nullable().describe("Folder the form was filed under, from its Tally workspace."),
    }),
    scopes: ["forms:write", "submissions:write"],
    async handler(ctx, args) {
      const empty = {
        formId: null,
        title: null,
        fieldCount: null,
        skipped: [] as { type: string; label: string }[],
        submissions: null,
        availableForms: [] as {
          tallyFormId: string
          name: string
          submissionCount: number
          tallyWorkspace: string | null
        }[],
        filed: null,
        nextPage: null,
        responsesError: null,
        folder: null,
      }

      switch (args.operation) {
        case "from_url": {
          if (!args.url) throw new ToolError("Importing from a link needs the Tally share URL.")
          const result = await importCore.importTallyForm(ctx, args.url)
          if (!result.success) throw new ToolError(result.error)
          return {
            ...empty,
            operation: args.operation,
            formId: result.formId,
            title: result.title,
            fieldCount: result.fieldCount,
            skipped: result.skipped,
          }
        }

        case "submissions": {
          if (!args.formId || !args.csv) {
            throw new ToolError("Importing responses needs both formId and the CSV contents.")
          }
          const result = await importCore.importTallySubmissions(ctx, args.formId, args.csv)
          if (!result.success) throw new ToolError(result.error)
          return {
            ...empty,
            operation: args.operation,
            formId: args.formId,
            submissions: {
              imported: result.imported,
              duplicates: result.duplicates,
              truncated: result.truncated,
              unmatched: result.unmatched,
            },
          }
        }

        case "list": {
          if (!args.apiKey) throw new ToolError("Listing Tally forms needs an API key.")
          const result = await importCore.listTallyApiForms(ctx, args.apiKey)
          if (!result.success) throw new ToolError(result.error)
          return {
            ...empty,
            operation: args.operation,
            availableForms: result.forms.map((f) => ({
              tallyFormId: f.id,
              name: f.name,
              submissionCount: f.submissionCount,
              tallyWorkspace: f.workspaceName,
            })),
          }
        }

        case "from_api": {
          if (!args.apiKey || !args.tallyFormId) {
            throw new ToolError("Importing via the API needs both apiKey and tallyFormId.")
          }
          const result = await importCore.importTallyFormFromApiKey(
            ctx,
            args.apiKey,
            args.tallyFormId,
            args.withSubmissions,
            args.startPage ? { startPage: args.startPage } : {},
          )
          if (!result.success) throw new ToolError(result.error)
          return {
            ...empty,
            operation: args.operation,
            formId: result.formId,
            title: result.title,
            fieldCount: result.fieldCount,
            skipped: result.skipped,
            submissions: {
              imported: result.imported,
              duplicates: result.duplicates,
              // The API path reports what it could not carry as deleted
              // questions rather than a truncation count.
              truncated: 0,
              unmatched: result.unmatched,
            },
            // A form too big for one call finishes across several. Surfaced
            // rather than swallowed: a silent partial import is the failure
            // mode where a user thinks they migrated and half their history
            // is missing.
            nextPage: result.nextPage,
            responsesError: result.responsesError ?? null,
            folder: result.folder,
          }
        }

        case "file_into_folders": {
          if (!args.apiKey) throw new ToolError("Filing into folders needs a Tally API key.")
          const result = await importCore.fileImportedFormsIntoFolders(ctx, args.apiKey)
          if (!result.success) throw new ToolError(result.error)
          return {
            ...empty,
            operation: args.operation,
            filed: {
              filed: result.filed,
              alreadyFiled: result.alreadyFiled,
              folders: result.folders,
            },
          }
        }
      }
    },
  }),
]
