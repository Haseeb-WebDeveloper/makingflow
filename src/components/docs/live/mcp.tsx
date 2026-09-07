import { CodeBlock } from "@/components/docs/mdx/code-block"
import {
  DocRow,
  DocTable,
  DocTableBody,
  DocTableHead,
  Td,
  Th,
} from "@/components/docs/mdx/doc-table"
import { SVGIcon } from "@/components/ui/svg-icon"
import { mcpEndpoint } from "@/lib/docs/site-url"
import type { Scope } from "@/lib/auth/context"
import { MCP_CLIENTS, SAMPLE_TOKEN, type McpClientInfo } from "@/lib/mcp/client-catalog"
import { PERMISSION_CHOICES } from "@/lib/mcp/scope-catalog"

/**
 * The parts of the MCP documentation that come from the catalogs.
 *
 * The point of these is proven: adding Le Chat and Perplexity to
 * `client-catalog.ts` needed no edit to any documentation, because both the
 * connect dialog and this page render the catalog rather than describing it.
 *
 * NOTHING HERE IMPORTS THE TOOL REGISTRY. It would be the most derived option
 * of all, but `src/lib/mcp/registry.ts` pulls in every tool and with them a
 * database connection — and a public docs page must not open one to render a
 * table. `webhook-policy.ts` makes the same trade in its header comment.
 */

/** The endpoint, via the one helper that reads the env correctly. */
export function McpEndpoint() {
  return <CodeBlock source={mcpEndpoint()} lang="bash" copy />
}

/** Inline variant, for naming the endpoint mid-sentence. */
export function McpEndpointInline() {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {mcpEndpoint()}
    </code>
  )
}

/**
 * One client's setup, in whichever of the two shapes it takes.
 *
 * Ported from the old page unchanged in behaviour. It deliberately mentions the
 * one-click deeplink without being one: a `cursor://` link that silently fails
 * to fire on a public page leaves the reader with nothing and no way to tell
 * why, so the button lives in the app where a key exists to put in it.
 */
function ClientGuide({ client }: { client: McpClientInfo }) {
  const endpoint = mcpEndpoint()
  const guide = client.install?.({ endpoint, token: SAMPLE_TOKEN })

  return (
    <div className="not-prose mt-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <SVGIcon
            src={client.icon}
            preserveColors={client.preserveColors}
            className="size-7 rounded-md border border-border"
            aria-hidden
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{client.name}</h3>
            <p className="text-xs text-foreground/65">{client.blurb}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {client.method === "oauth" ? "Signs in with MakingFlow" : "Uses an API key"}
        </span>
      </div>

      {client.steps ? (
        <ol className="mt-3 space-y-2 text-sm leading-6 text-foreground/90">
          {client.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {client.method === "oauth" ? (
        <div className="mt-3">
          <CodeBlock source={endpoint} lang="bash" />
        </div>
      ) : null}

      {guide ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Create a key in <strong className="text-foreground">Integrations</strong>, then:
          </p>
          <CodeBlock source={guide.code} lang={guide.codeLanguage} />
          {guide.note ? <p className="text-xs text-muted-foreground">{guide.note}</p> : null}
          {guide.deeplink ? (
            <p className="text-xs text-muted-foreground">
              The connect dialog also offers a one-click{" "}
              <strong className="text-foreground">{guide.deeplinkLabel}</strong> button, which
              installs this for you.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Every client of one kind, straight from the catalog. */
export function McpClientGuides({ method }: { method: McpClientInfo["method"] }) {
  return (
    <>
      {MCP_CLIENTS.filter((c) => c.method === method).map((c) => (
        <ClientGuide key={c.id} client={c} />
      ))}
    </>
  )
}

/**
 * The permissions, as the consent screen and the key dialog describe them.
 *
 * Now also renders the `sensitive` flag, which the catalog carries and both
 * in-app surfaces show — the public page used to drop it, so a reader comparing
 * this table with the consent screen saw two different pictures of the two
 * permissions that matter most.
 */
export function McpPermissionsTable() {
  return (
    <DocTable>
      <DocTableHead>
        <Th>Scope</Th>
        <Th>Grants</Th>
        <Th>What it covers</Th>
      </DocTableHead>
      <DocTableBody>
        {PERMISSION_CHOICES.map((p) => (
          <DocRow key={p.scope}>
            <Td mono nowrap>
              {p.scope}
            </Td>
            <Td emphasis>
              {p.label}
              {p.sensitive ? (
                <span className="ml-2 rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-warning-foreground">
                  Sensitive
                </span>
              ) : null}
            </Td>
            <Td>{p.help}</Td>
          </DocRow>
        ))}
      </DocTableBody>
    </DocTable>
  )
}

/**
 * What the tools cover, by area.
 *
 * `scopes` is typed `Scope[]` rather than a display string, so renaming a scope
 * in `auth/context.ts` fails the build here instead of leaving the page quietly
 * naming a permission that no longer exists.
 */
const TOOL_GROUPS: { name: string; scopes: Scope[]; tools: string }[] = [
  {
    name: "Forms",
    scopes: ["forms:read", "forms:write"],
    tools: "list, get, create, edit, publish, rename, duplicate, delete, folders, move",
  },
  {
    name: "Responses",
    scopes: ["submissions:read", "submissions:write"],
    tools: "list, get, export, analyse with AI, delete",
  },
  {
    name: "Analytics",
    scopes: ["analytics:read"],
    tools: "workspace dashboard, per-form insights",
  },
  {
    name: "Integrations",
    scopes: ["integrations:write"],
    tools: "webhooks, Sheets, Notion, email and Discord notifications",
  },
  {
    name: "Team & domains",
    scopes: ["team:write", "forms:write"],
    tools: "members, invitations, custom domains",
  },
]

export function McpToolTable() {
  return (
    <DocTable>
      <DocTableHead>
        <Th>Area</Th>
        <Th>Permissions</Th>
        <Th>Tools</Th>
      </DocTableHead>
      <DocTableBody>
        {TOOL_GROUPS.map((g) => (
          <DocRow key={g.name}>
            <Td emphasis>{g.name}</Td>
            <Td mono>{g.scopes.join(", ")}</Td>
            <Td>{g.tools}</Td>
          </DocRow>
        ))}
      </DocTableBody>
    </DocTable>
  )
}
