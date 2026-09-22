import { getDefaultWorkspace } from "@/lib/auth/session"
import { verifyExportToken } from "@/lib/mcp/export-token"
import {
  DEFAULT_SPEC,
  exportSpecSchema,
  isSyncEligible,
  parseExportSpec,
  syncCeilingFor,
  type ExportSpec,
} from "@/lib/submissions/export-spec"
import { countExportRows, openExport } from "@/lib/submissions/export-query"
import {
  CONTENT_TYPES,
  csvChunks,
  exportFileName,
  jsonChunks,
} from "@/lib/submissions/export-serialize"
import { writeXlsx } from "@/lib/submissions/export-xlsx"

export const maxDuration = 60

/**
 * Downloading one form's responses.
 *
 * TWO WAYS IN, ONE TENANCY CHECK. A browser session is the ordinary one; a
 * `?token=` handle is for links minted by `makingflow_export_submissions`,
 * where the person opening it may not be signed in at all. The token names its
 * own form and is checked against the requested id — a valid handle for form A
 * must not download form B — and its workspace then goes through the same
 * `openExport` tenancy query a session's does. A signed URL is a shortcut past
 * the login page and nothing more.
 *
 * A TOKEN'S SPEC WINS. When a handle carries one, the query string is ignored
 * entirely: a link minted for two columns must not turn into a link for forty
 * by editing the URL.
 *
 * THIS ROUTE ONLY EVER SERVES WHAT IT CAN FINISH. `maxDuration` is 60s and the
 * headers are flushed with the first chunk, so an export that runs out of time
 * would arrive as a valid-looking file with rows missing — the exact failure the
 * streaming rewrite was meant to remove. A pre-flight count refuses anything
 * above the format's ceiling with a 413 naming the count and the limit.
 *
 * CSV AND JSON STREAM; XLSX DOES NOT. A workbook is only valid once finalised,
 * so it is built whole and sent in one body, under a lower ceiling. That is an
 * inherent property of the format, not a policy choice.
 */
type Authorized = { workspaceId: string; spec: ExportSpec }

async function authorize(request: Request, formId: string): Promise<Authorized | null> {
  const params = new URL(request.url).searchParams
  const token = params.get("token")

  if (token) {
    const grant = verifyExportToken(token)
    if (!grant || grant.formId !== formId) return null
    const spec = grant.spec ? exportSpecSchema.parse(grant.spec) : DEFAULT_SPEC
    return { workspaceId: grant.workspaceId, spec }
  }

  const workspace = await getDefaultWorkspace()
  if (!workspace) return null
  return { workspaceId: workspace.id, spec: parseExportSpec(params) }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(request, id)
  if (!auth) return new Response("Unauthorized", { status: 401 })

  const source = await openExport(id, auth.workspaceId, auth.spec)
  // An id from another tenant is indistinguishable from one that never existed.
  if (!source) return new Response("Not found", { status: 404 })

  const rowCount = await countExportRows(id, auth.spec)
  if (!isSyncEligible(auth.spec, rowCount)) {
    return new Response(
      `This export is too large to build in one request (${rowCount.toLocaleString()} responses, limit ${syncCeilingFor(
        auth.spec.format,
      ).toLocaleString()}). Narrow it with a filter or a date range${
        auth.spec.format === "xlsx" ? ", or export as CSV, which has no such limit" : ""
      }.`,
      { status: 413 },
    )
  }

  const now = new Date()
  const filename = exportFileName(source.form.title, auth.spec.format, now)

  // A WORKBOOK IS NOT STREAMABLE: it is only valid once finalised, so this one
  // format is buffered and sent whole. Bounded by its own lower row ceiling
  // above, which is why that is not the same number as the streaming formats'.
  if (auth.spec.format === "xlsx") {
    const { bytes } = await writeXlsx(source)
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "content-type": CONTENT_TYPES.xlsx,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    })
  }

  const chunks =
    auth.spec.format === "json"
      ? jsonChunks(source, { spec: auth.spec, exportedAt: now })
      : csvChunks(source)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // `pull`, not a loop in `start`: the stream asks for the next chunk when
      // the consumer is ready for it, so a slow client cannot make us buffer
      // the whole export in memory.
      try {
        const next = await chunks.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (err) {
        console.error("[export] failed", err)
        controller.error(err)
      }
    },
    cancel() {
      void chunks.return(undefined)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": CONTENT_TYPES[auth.spec.format],
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
}
