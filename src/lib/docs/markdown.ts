import "server-only"

import { NODE_RECEIVER, PAYLOAD_SAMPLE, PYTHON_RECEIVER } from "@/content/docs/_samples/webhook-receivers"
import { docBySlug } from "@/lib/docs/pages"
import { mcpEndpoint } from "@/lib/docs/site-url"
import { readDocSource } from "@/lib/docs/source"
import { DOC_VALUES, humanDelay, isDocValueKey } from "@/lib/docs/values"
import { MCP_CLIENTS, SAMPLE_TOKEN } from "@/lib/mcp/client-catalog"
import { PERMISSION_CHOICES } from "@/lib/mcp/scope-catalog"
import { BACKOFF_SECONDS } from "@/lib/integrations/webhook-policy"
import {
  DELIVERY_ID_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  SUBMISSION_CREATED_EVENT,
  USER_AGENT,
} from "@/lib/integrations/webhook-signature"

/**
 * A documentation page as plain Markdown.
 *
 * FOR MACHINES, MOSTLY. It backs "Copy page", "View as Markdown" and the
 * open-in-ChatGPT/Claude links — a reader who wants an assistant's help with an
 * integration should be able to hand it the page rather than describe it.
 *
 * Serving the raw `.mdx` would be easier and much worse: an assistant would
 * receive `<WebhookRetryTable />` and `<Val name="webhook.timeoutSeconds" />`,
 * which are exactly the facts it needs and the only parts it cannot resolve.
 * So every component expands from the SAME module the rendered page reads,
 * which means the Markdown carries the real retry ladder and the real timeout,
 * and cannot drift from the HTML.
 *
 * Anything not expanded here is dropped rather than emitted as a tag, on the
 * principle that a missing table is better than one an assistant will quote as
 * literal JSX.
 */

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n")
}

function fence(lang: string, code: string): string {
  return `\`\`\`${lang}\n${code}\n\`\`\``
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]

/** Component tag → the Markdown it stands for. Mirrors the React components. */
const BLOCKS: Record<string, () => string> = {
  WebhookRetryTable: () =>
    table(
      ["Attempt", "When"],
      [
        [ORDINALS[0], "Immediately, as the response is stored"],
        ...BACKOFF_SECONDS.map((seconds, i) => [
          ORDINALS[i + 1] ?? `${i + 2}th`,
          `~${humanDelay(seconds)} later${i === BACKOFF_SECONDS.length - 1 ? " — the last one" : ""}`,
        ]),
      ],
    ),

  WebhookHeadersTable: () =>
    table(
      ["Header", "Example", "Notes"],
      [
        [
          `\`${SIGNATURE_HEADER}\``,
          "`t=1757246400,v1=5257a8...`",
          "HMAC-SHA256 proving the delivery came from us. Only sent when the endpoint has a signing secret.",
        ],
        [
          `\`${DELIVERY_ID_HEADER}\``,
          "`550e8400-e29b-41d4-a716-446655440000`",
          "Stable across every retry of this delivery. Deduplicate on it.",
        ],
        [`\`${EVENT_HEADER}\``, `\`${SUBMISSION_CREATED_EVENT}\``, "What happened."],
        ["`Content-Type`", "`application/json`", ""],
        ["`User-Agent`", `\`${USER_AGENT}\``, ""],
      ],
    ),

  WebhookPayloadSample: () => fence("json", PAYLOAD_SAMPLE),

  McpEndpoint: () => fence("text", mcpEndpoint()),
  McpEndpointInline: () => `\`${mcpEndpoint()}\``,

  McpPermissionsTable: () =>
    table(
      ["Scope", "Grants", "What it covers"],
      PERMISSION_CHOICES.map((p) => [
        `\`${p.scope}\``,
        p.sensitive ? `${p.label} (sensitive)` : p.label,
        p.help,
      ]),
    ),

  McpToolTable: () =>
    table(
      ["Area", "Permissions", "Tools"],
      [
        ["Forms", "`forms:read`, `forms:write`", "list, get, create, edit, publish, rename, duplicate, delete, folders, move"],
        ["Responses", "`submissions:read`, `submissions:write`", "list, get, export, analyse with AI, delete"],
        ["Analytics", "`analytics:read`", "workspace dashboard, per-form insights"],
        ["Integrations", "`integrations:write`", "webhooks, Sheets, Notion, email and Discord notifications"],
        ["Team & domains", "`team:write`, `forms:write`", "members, invitations, custom domains"],
      ],
    ),
}

/** Components that take a prop, so they need the attribute string to expand. */
function expandWithProps(tag: string, attrs: string): string | null {
  if (tag === "WebhookReceiver") {
    const runtime = /runtime="(node|python)"/.exec(attrs)?.[1]
    if (runtime === "node") return fence("js", NODE_RECEIVER)
    if (runtime === "python") return fence("python", PYTHON_RECEIVER)
    return null
  }

  if (tag === "McpClientGuides") {
    const method = /method="(oauth|api-key)"/.exec(attrs)?.[1]
    const clients = MCP_CLIENTS.filter((c) => c.method === method)
    const endpoint = mcpEndpoint()

    return clients
      .map((client) => {
        const lines = [`### ${client.name}`, "", client.blurb, ""]
        if (client.steps) {
          lines.push(...client.steps.map((step, i) => `${i + 1}. ${step}`), "")
        }
        if (client.method === "oauth") {
          lines.push(fence("text", endpoint), "")
        }
        const guide = client.install?.({ endpoint, token: SAMPLE_TOKEN })
        if (guide) {
          lines.push(fence(guide.codeLanguage, guide.code), "")
          if (guide.note) lines.push(guide.note, "")
        }
        return lines.join("\n")
      })
      .join("\n")
  }

  if (tag === "Callout") {
    // The wrapper disappears and the prose inside stays. A blockquote would be
    // tidier, but the children span multiple lines and re-indenting them here
    // is more likely to mangle a code span than to help a reader.
    return ""
  }

  return null
}

/**
 * Strip the MDX that has no Markdown meaning.
 *
 * RUNS ONCE, BEFORE ANY COMPONENT IS EXPANDED. Running it again afterwards
 * looks harmless and silently corrupts the output: the expanded receivers open
 * with `import crypto from "node:crypto"`, and a second pass deletes that line
 * as though it were MDX — publishing a signature-verification sample whose
 * first line is missing, to be pasted into someone's server.
 */
function stripMdxSyntax(source: string): string {
  return source
    .replace(/^import\s.+$/gm, "")
    .replace(/^export\s[\s\S]*?^\}/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .trim()
}

/** Collapse the blank lines left by removed tags. Safe to run over code. */
function tidyBlankLines(source: string): string {
  return source.replace(/\n{3,}/g, "\n\n").trim()
}

export function docMarkdown(slug: string): string | null {
  const page = docBySlug(slug)
  if (!page) return null

  let body = stripMdxSyntax(readDocSource(slug))

  // `## What we send [#payload]` pins an anchor, which is an MDX-only
  // convention. In Markdown it is noise an assistant would quote back.
  body = body.replace(/^(#{2,6}\s+.*?)\s*\[#[a-z0-9-]+\]\s*$/gim, "$1")

  // Values first: they appear inside sentences, so a later tag sweep would
  // otherwise take them out along with the components.
  body = body.replace(/<Val\s+name="([^"]+)"\s*\/>/g, (_match, name: string) =>
    isDocValueKey(name) ? DOC_VALUES[name] : "",
  )

  // Self-closing components with props.
  body = body.replace(/<([A-Z][A-Za-z]*)\s([^>]*?)\/>/g, (match, tag: string, attrs: string) => {
    const expanded = expandWithProps(tag, attrs)
    return expanded === null ? match : expanded
  })

  // Self-closing components without props.
  body = body.replace(/<([A-Z][A-Za-z]*)\s*\/>/g, (match, tag: string) =>
    BLOCKS[tag] ? BLOCKS[tag]() : match,
  )

  // Paired components — keep the children, drop the wrapper.
  body = body.replace(/<([A-Z][A-Za-z]*)(\s[^>]*)?>/g, "").replace(/<\/[A-Z][A-Za-z]*>/g, "")

  // The h1 lives in the page shell rather than the document, so it has to be
  // put back or the Markdown arrives with no title.
  const heading = `# ${page.title}\n\n> ${page.description}`

  return `${heading}\n\n${tidyBlankLines(body)}\n`
}
