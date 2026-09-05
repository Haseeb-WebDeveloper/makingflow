# The MakingFlow MCP server

Lets any MCP-capable AI client act on a workspace with the same authority its
owner has in the browser. 27 tools, MCP revision **2026-07-28**, served at
`/api/mcp`.

---

## Two doors, and why there are two

| | API key | OAuth |
| --- | --- | --- |
| Works with | Claude Code, Cursor, VS Code | ChatGPT, claude.ai |
| Credential | `Authorization: Bearer mf_sk_live_…` | access token from an authorization server |
| Set up from | `/integrations` → Connect | the client's "add connector" flow |
| Needs config | nothing | `MCP_OAUTH_ISSUER` |

The second is not a nicer version of the first. OpenAI's connector docs are
explicit that ChatGPT "does not support machine-to-machine OAuth grants such as
client credentials, service accounts, or JWT bearer assertions, nor can it
present custom API keys" — there is no header field anywhere in the UI. So OAuth
is the only door those clients can use, and the key path is the only one the
others need.

**Past authentication the two are identical.** Same tools, same scope filtering,
same tenancy checks, same audit rows. That is deliberate: a second credential
that took a second code path would be a second permission system to keep
correct, and the one that gets forgotten is the one that leaks.

---

## How authority is decided

A credential proves **who** is calling. It never decides **what** they may do.

```
credential  →  principal (user + granted workspaces + scopes)
                    ∩  live workspace_members
               →  AuthContext for ONE workspace  →  tool
```

The grant is intersected with live membership on **every request**. Someone
removed from a workspace this morning still holds a perfectly valid token minted
last week — this is what makes that harmless. There is no revocation sweep, and
no role is ever cached on a credential.

The grant can lose reach. It can never gain it: joining a new workspace does not
widen an existing key or connection, because the grant is an explicit list, never
a wildcard.

Two independent gates run per tool call:

- **scopes** constrain the credential (`forms:write`, `submissions:read`, …)
- **`action`** constrains the person, via the same `OWNER_ONLY` table the browser
  uses — so a member's key holding `team:write` still cannot invite anyone

---

## Configuring OAuth

OAuth is **off** unless `MCP_OAUTH_ISSUER` is set. A deployment without it keeps
working exactly as it does today and advertises no `authorization_servers` in its
discovery document, which is the honest answer for a self-hosted install.

```bash
# Required to switch OAuth on.
MCP_OAUTH_ISSUER=https://your-authkit-domain.workos.com

# Optional. Defaults to <issuer>/oauth2/jwks.
MCP_OAUTH_JWKS_URI=https://your-authkit-domain.workos.com/oauth2/jwks
```

`APP_ENCRYPTION_KEY` and `NEXT_PUBLIC_SITE_URL` must already be set — the first
signs export links, the second is the canonical resource identifier.

### Do not half-configure it

A client that reads a non-empty `authorization_servers` **commits** to the OAuth
flow and never falls back to the header it would otherwise have used. Pointing at
an issuer that cannot mint tokens for us therefore breaks clients that were
working. Either configure it fully or leave it unset.

### What to set up at the authorization server

Using WorkOS AuthKit in **Standalone Connect** mode (Supabase stays as the only
thing that ever sees a password):

1. **Login URI** → `https://<your-domain>/api/mcp/oauth/login`
   The AS sends users here to authenticate. We check for a Supabase session and
   hand back our own `users.id` as `external_auth_id`, so the token's `sub`
   resolves directly against `users` with no mapping table.

2. **Resource URL** → `https://<your-domain>/api/mcp`
   Must match `NEXT_PUBLIC_SITE_URL + /api/mcp` **byte for byte** — no trailing
   slash. This is what clients send as `resource` (RFC 8707) and what lands in
   `aud`. Changing it is a breaking change for every issued token.

3. **Enable** Dynamic Client Registration and Client ID Metadata Documents.
   Claude falls back to DCR unless it sees both
   `client_id_metadata_document_supported: true` and
   `token_endpoint_auth_methods_supported: ["none"]`.

4. **Redirect URIs** the real clients use:
   - `https://claude.ai/api/mcp/auth_callback`
   - `https://chatgpt.com/connector_platform_oauth_redirect`
   - `https://chatgpt.com/connector/oauth/*`
   - `http://localhost/callback` and `http://127.0.0.1/callback` **with the port
     ignored** — Claude Code binds an ephemeral loopback port.

### Why not Supabase's OAuth server

Two blockers, verified in shipping code rather than inferred:

- **No RFC 8707 audience binding.** `authorize.go` validates and persists the
  `resource` parameter and `handlers.go` cross-checks it at token exchange — then
  `tokens/service.go` mints `Audience: jwt.ClaimStrings{params.User.Aud}`, which
  is always `"authenticated"`. The string `resource` appears nowhere in that file.
  The MCP spec says a server MUST validate that tokens were issued for it; with
  this we cannot, and a token from any client registered on the project would
  pass — a live confused-deputy exposure.
- **No custom scopes.** `models/oauth_scope.go` hard-codes five OIDC scopes and
  rejects everything else.

**The trap worth naming:** the `resource` parameter round-trips cleanly, so
integration testing *looks* like it works right up until you decode a token and
check `aud`.

The second blocker turned out not to matter — see below — but the first is
disqualifying on its own.

### Why the token carries so little

It answers exactly two questions: **which user**, and **which client**. Scopes
and workspaces live in `mcp_oauth_grants`, our own table, re-read every request.

That is not a workaround, it is the correct design. A token is a snapshot taken
at consent, and a snapshot of authority goes stale — so authority has to come
from rows we control. It also means no authorization server needs to model our
eight scopes to be usable here, which is what keeps the vendor choice reversible.

---

## Secrets that must never reach a model

Every tool output is a **closed Zod schema with no passthrough**, so a field that
leaks one of these fails validation instead of shipping.

| Secret | Handling |
| --- | --- |
| webhook signing secret | never returned; listings report `hasSecret: boolean` |
| Discord webhook URL | masked — the URL *is* the credential |
| Google/Notion access + refresh tokens | never selected by the query |
| workspace invite link | absent from every schema; `/invite/<token>` grants membership to whoever opens it |
| Tally API key | inbound only, never stored — a Tally key can delete the account's forms |
| CSV export | returns a signed 15-minute link, never the file |

---

## Operational notes

- **Rate limits** are per credential per minute, counted in Postgres: 300 reads,
  120 writes, 20 AI calls. Fails **open** — a counter that cannot be read is not
  a reason to reject a legitimate call.
- **Audit** (`mcp_audit_log`) records the tool and the row it touched, never the
  arguments. Tool arguments carry respondent answers, and an audit table is the
  last place that should accumulate.
- **Claude reaches us over IPv4 only.** A hostname with only `AAAA` records is
  unreachable, and a WAF rule can silently block egress `160.79.104.0/21`.
- **No cross-host redirects** on `/api/mcp`: a 301/302 to another host drops the
  `Authorization` header. This is the classic "works in curl, fails on claude.ai".

## Managing connections

`pnpm mcp:key list | mint | revoke` for keys. `/integrations` → **View details**
shows both keys and connected apps, and disconnects either — effective on the
credential's very next request.
