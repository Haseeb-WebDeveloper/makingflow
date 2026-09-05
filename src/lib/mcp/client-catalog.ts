/**
 * The AI clients people connect from, and how each one actually connects.
 *
 * THE DISTINCTION THAT ORGANISES THIS FILE: which client you use decides
 * whether there is anything to do on our side at all.
 *
 * ChatGPT and Claude authenticate connectors through OAuth and have no field
 * anywhere in their UI for an API key. Their flow starts in THEIR settings, not
 * ours — so offering those users a key is not merely unhelpful, it is a dead
 * end they cannot detect: they get a credential, nothing errors, and there is
 * no way to finish. That is what `method: "oauth"` exists to prevent.
 *
 * Claude Code, Cursor and VS Code take a header, so they need a key — and each
 * installs it differently. Handing a Cursor user a `claude mcp add` command is
 * the same category of mistake, smaller.
 *
 * Lives in one place because two surfaces render it: the connect dialog on
 * /integrations and the public /docs/mcp page. Two copies would drift, and the
 * drift would be instructions that no longer work.
 *
 * No `server-only`: imported by client components on both sides.
 */

export type ConnectMethod = "oauth" | "api-key"

export type InstallGuide = {
  /**
   * One-click install, where the client offers one. Always accompanied by the
   * copyable config below — a deeplink that does not fire leaves the user with
   * nothing, and a protocol handler is exactly the kind of thing that silently
   * does not fire.
   */
  deeplink?: string
  deeplinkLabel?: string
  /** What to paste. Present for every client, always. */
  code: string
  codeLanguage: "shell" | "json"
  note?: string
}

export type McpClientInfo = {
  id: string
  name: string
  /** What it is, for someone who has not heard of it. */
  blurb: string
  method: ConnectMethod
  /** OAuth clients: what the user does in THAT app. */
  steps?: string[]
  /** Key clients: what to do once they hold one. */
  install?: (args: { endpoint: string; token: string }) => InstallGuide
}

/** Placeholder shown in public docs, where there is no real key. */
export const SAMPLE_TOKEN = "mf_sk_live_..."

/** The server entry both Cursor and VS Code understand. */
function httpServerConfig(endpoint: string, token: string) {
  return { url: endpoint, headers: { Authorization: `Bearer ${token}` } }
}

/**
 * base64 for a deeplink payload.
 *
 * `btoa` in the browser, `Buffer` on the server — the docs page renders this
 * during SSR, where `btoa` does not exist. The payload is a URL and a token, so
 * it is always ASCII and `btoa`'s unicode limitation cannot bite.
 */
function base64(value: string): string {
  return typeof btoa === "function"
    ? btoa(value)
    : Buffer.from(value, "utf8").toString("base64")
}

export const MCP_CLIENTS: readonly McpClientInfo[] = [
  {
    id: "claude",
    name: "Claude",
    blurb: "claude.ai, and the desktop and mobile apps",
    method: "oauth",
    steps: [
      "Open claude.ai → Settings → Connectors.",
      "Choose Add custom connector and paste the URL below. Leave the OAuth client fields empty — Claude registers itself.",
      "Claude sends you back here to sign in and choose what it may reach.",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    blurb: "Requires developer mode for custom connectors",
    method: "oauth",
    steps: [
      "Open ChatGPT → Settings → Connectors.",
      "Choose Add custom connector and paste the URL below.",
      "ChatGPT sends you back here to sign in and choose what it may reach.",
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    blurb: "Anthropic's terminal and IDE agent",
    method: "api-key",
    install: ({ endpoint, token }) => ({
      code: `claude mcp add --scope user --transport http makingflow ${endpoint} --header "Authorization: Bearer ${token}"`,
      codeLanguage: "shell",
      note: "Run it as a single line. A line break inside the quotes puts a newline in the HTTP header and fails with an unhelpful error.",
    }),
  },
  {
    id: "cursor",
    name: "Cursor",
    blurb: "The AI code editor",
    method: "api-key",
    install: ({ endpoint, token }) => ({
      deeplink: `cursor://anysphere.cursor-deeplink/mcp/install?name=makingflow&config=${encodeURIComponent(
        base64(JSON.stringify(httpServerConfig(endpoint, token))),
      )}`,
      deeplinkLabel: "Add to Cursor",
      code: JSON.stringify(
        { mcpServers: { makingflow: httpServerConfig(endpoint, token) } },
        null,
        2,
      ),
      codeLanguage: "json",
      note: "If the button doesn't open Cursor, paste this into Settings → MCP instead.",
    }),
  },
  {
    id: "vscode",
    name: "VS Code",
    blurb: "With GitHub Copilot's agent mode",
    method: "api-key",
    install: ({ endpoint, token }) => ({
      deeplink: `vscode:mcp/install?${encodeURIComponent(
        JSON.stringify({ name: "makingflow", type: "http", ...httpServerConfig(endpoint, token) }),
      )}`,
      deeplinkLabel: "Add to VS Code",
      code: JSON.stringify(
        { servers: { makingflow: { type: "http", ...httpServerConfig(endpoint, token) } } },
        null,
        2,
      ),
      codeLanguage: "json",
      note: "If the button doesn't open VS Code, add this to your mcp.json instead.",
    }),
  },
  {
    id: "other",
    name: "Something else",
    blurb: "Any MCP client that can send a header",
    method: "api-key",
    install: ({ endpoint, token }) => ({
      code: `${endpoint}\n\nAuthorization: Bearer ${token}`,
      codeLanguage: "shell",
      note: "Streamable HTTP, POST only. Point the client at the endpoint and send the key as a bearer token.",
    }),
  },
]

export function clientById(id: string): McpClientInfo | undefined {
  return MCP_CLIENTS.find((c) => c.id === id)
}

export const OAUTH_CLIENTS = MCP_CLIENTS.filter((c) => c.method === "oauth")
export const KEY_CLIENTS = MCP_CLIENTS.filter((c) => c.method === "api-key")
