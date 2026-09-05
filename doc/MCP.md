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
| Credential lifetime | until revoked | 1h access, 30d rotating refresh |
| Needs config | nothing | nothing |

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

## OAuth: we are our own authorization server

There is nothing to configure and no vendor to sign up with. `/api/mcp` and the
authorization server are the same deployment, which is what makes the rest of
this section simple.

| Endpoint | What it is |
| --- | --- |
| `/.well-known/oauth-authorization-server` | discovery (RFC 8414) |
| `/api/oauth/register` | client registration (RFC 7591) — **JSON** |
| `/api/oauth/authorize` | consent, then an authorization code |
| `/api/oauth/token` | code → tokens, and refresh — **form-urlencoded** |
| `/api/oauth/revoke` | revocation (RFC 7009) |

Two parsers, deliberately: RFC 7591 says JSON and RFC 6749 says form-urlencoded.
A server that uses one for both returns 415 to every real client, after the rest
of the flow appeared to work perfectly.

### Why not a hosted authorization server

The obvious candidates were ruled out for different reasons.

**Supabase's**, on inspection of shipping code: `authorize.go` validates and
persists the RFC 8707 `resource` parameter and `handlers.go` cross-checks it at
token exchange — then `tokens/service.go` mints `Audience:
jwt.ClaimStrings{params.User.Aud}`, which is always `"authenticated"`. The MCP
spec says a server MUST validate that tokens were issued for it; with that we
cannot, and a token from any client on the project would pass. It also hard-codes
five OIDC scopes in `models/oauth_scope.go` and rejects everything else.

**The trap worth naming:** the `resource` parameter round-trips cleanly, so
integration testing *looks* like it works right up until you decode a token and
check `aud`.

**WorkOS** does all of that correctly, but production needs billing. It also
would not have removed much work: identity is Supabase's, consent and the
workspace grant are ours either way, so the vendor was only ever supplying four
endpoints.

### Tokens are opaque, not JWTs

A signed token earns its complexity when the verifier cannot ask the issuer.
Here they are the same request handler, so a signature would buy nothing and cost
key management, rotation, and the audience check above.

An opaque random string looked up by HMAC — exactly how API keys already work —
is simpler and strictly better where it counts: **Disconnect takes effect on the
app's very next request**, rather than whenever its token happened to expire.

Access tokens live an hour; refresh tokens thirty days and **rotate** on every
use. Nothing is stored in the clear.

### The refusals that matter

An authorization server is mostly a set of refusals, each stopping a specific way
of stealing an account. Every one is covered in `tests/integration/oauth-flow.test.ts`.

- **Redirect URIs match as exact strings.** Prefix matching is the classic
  mistake: `https://good.test/cb` also prefixes `https://good.test/cb.evil.test`.
  The one carve-out is loopback, where RFC 8252 requires the port to be ignored
  because a desktop client cannot know its port in advance.
- **An unknown client or unmatched redirect is SHOWN, never followed.** Redirecting
  to an unvalidated URI is the open redirect this endpoint exists not to be.
- **PKCE (S256) is mandatory.** It is what replaces a client secret for software
  that cannot hold one. `plain` is refused — the challenge would be the verifier.
- **A code redeemed twice revokes everything it produced.** Harsher than refusing
  the replay, on purpose: refusing only the second attempt leaves whoever
  redeemed first — quite possibly the attacker — holding live tokens.
- **A reused refresh token kills the whole connection**, for the same reason.

### Consent

Being our own authorization server means we always know which client is asking,
so `/oauth/consent` can ask the question a hosted server cannot: **which
workspaces**, and what may the app do in them. Nothing is pre-ticked, and reading
responses is off by default — it is the permission that hands respondent PII to a
third party.

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
