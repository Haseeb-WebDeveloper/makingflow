/**
 * The AI clients people connect from, and how each one actually connects.
 *
 * THE DISTINCTION THAT ORGANISES THIS FILE: which client you use decides
 * whether there is anything to do on our side at all.
 *
 * Claude, ChatGPT, Le Chat and Perplexity authenticate connectors through
 * OAuth and have no field anywhere in their UI for an API key. Their flow starts in THEIR settings, not
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
  /** Whether to preserve the original colors of the icon. */
  preserveColors?: boolean
  /**
   * Brand mark under /public/logo, rendered with `preserveColors`.
   *
   * Each file is a self-contained square: chatgpt.svg and cursor.svg carry
   * their own full-bleed background rect (white and black respectively), so
   * they must NOT be recoloured or mask-rendered — a white-on-transparent
   * glyph would vanish on the light picker, a black one on the dark panel.
   * That is why these are `preserveColors` everywhere they appear.
   */
  icon: string
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
    icon: "/logo/claude.svg",
    preserveColors: true,
    method: "oauth",
    steps: [
      "Open Claude → Customize → Connectors, then + → Add custom connector. On Team and Enterprise an owner adds it once under Organization settings → Connectors, and everyone else then presses Connect on it.",
      "Paste the URL below and choose Add. Leave the OAuth client id and secret under Advanced settings empty — Claude registers itself, so anything typed there is a credential nothing issued.",
      "Claude sends you back here to sign in and choose what it may reach.",
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    blurb: "Requires developer mode for custom connectors",
    icon: "/logo/chatgpt.svg",
    preserveColors: false,
    method: "oauth",
    steps: [
      "Open ChatGPT → Settings and turn on Developer mode, under Security and login. Custom connectors stay hidden until you do, and it needs a paid plan.",
      "Still in Settings, open Plugins, press + and paste the URL below as the server URL, then save.",
      "ChatGPT sends you back here to sign in and choose what it may reach.",
    ],
  },
  {
    id: "lechat",
    name: "Le Chat",
    blurb: "Mistral's assistant — a workspace admin adds connectors",
    icon: "/logo/mistral.svg",
    preserveColors: true,
    method: "oauth",
    steps: [
      "Open Le Chat → Connectors, then + Add Connector.",
      "Switch to the Custom MCP Connector tab. Give it a name without spaces, and paste the URL below as the server URL.",
      "Choose Connect. Le Chat detects the authentication itself — there is no client id or secret to supply — and sends you back here to sign in and choose what it may reach.",
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    blurb: "Custom connectors need Pro, Max or Enterprise",
    icon: "/logo/perplexity.svg",
    preserveColors: true,
    method: "oauth",
    steps: [
      "Open Perplexity → Settings → Connectors, then Add a connector → Custom MCP server.",
      "Paste the URL below. Open Advanced settings and leave the transport on Streamable HTTP — we do not serve SSE.",
      "Leave the authentication on OAuth with the client fields empty: we register Perplexity ourselves, so an id and secret typed in here are ones nothing issued.",
      "Tick the risk acknowledgement and choose Add. Perplexity sends you back here to sign in and choose what it may reach.",
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    blurb: "Anthropic's terminal and IDE agent",
    icon: "/logo/claude-code.svg",
    preserveColors: true,
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
    icon: "/logo/cursor.svg",
    preserveColors: true,
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
    icon: "/logo/vscode.svg",
    preserveColors: true,
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
    icon: "/logo/mcp.svg",
    preserveColors: false,
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
