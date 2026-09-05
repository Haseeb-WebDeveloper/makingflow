"use client";

/**
 * The "Connect an AI assistant" card.
 *
 * The whole flow lives here: create a key, see it exactly once, copy the
 * ready-made connect command, and revoke.
 *
 * Two things drive the design.
 *
 * The secret is shown ONCE and cannot be recovered — the database holds only an
 * HMAC of it. That is a real constraint, not a UI preference, so the reveal
 * step is a deliberate stop with a copy button rather than a line of text a
 * user might scroll past.
 *
 * The command is assembled for the user, key included. Every person who has hit
 * this flow so far broke it by pasting the token across two lines, which puts a
 * newline inside the HTTP header and fails with an unhelpful error. One
 * copy-to-clipboard removes that failure mode entirely.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { CardShell } from "@/components/integrations/cards";
import { createMcpKey, revokeMcpKey } from "@/lib/actions/mcp-keys";
import type { KeySummary } from "@/lib/core/mcp-keys";

/**
 * The permissions offered in the UI.
 *
 * `destructive` is deliberately ABSENT. It permanently deletes forms and every
 * response with them, and there is no undo — that is not something anyone
 * should be able to grant with a stray click while skimming a checkbox list.
 * It stays available through `pnpm mcp:key` for the rare case that wants it.
 */
const PERMISSIONS: { scope: string; label: string; help: string }[] = [
  { scope: "forms:read", label: "Read forms", help: "See forms, fields and settings" },
  { scope: "forms:write", label: "Build and edit forms", help: "Create, edit and publish" },
  {
    scope: "submissions:read",
    label: "Read responses",
    help: "Includes names, emails and anything else respondents submitted",
  },
  { scope: "submissions:write", label: "Analyse responses", help: "Run AI summaries and scoring" },
  { scope: "analytics:read", label: "Read analytics", help: "Views, completion and drop-off" },
];

const DEFAULT_SCOPES = ["forms:read", "forms:write", "analytics:read"];

const EXPIRY_OPTIONS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "No expiry" },
];

export type McpCardProps = {
  keys: KeySummary[];
  /** Workspaces the viewer belongs to, so one key can cover several. */
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string;
  /** Owners only — minting a key that can read every response is owner-weight. */
  canCreate: boolean;
  endpoint: string;
};

export function McpCard({
  keys,
  workspaces,
  currentWorkspaceId,
  canCreate,
  endpoint,
}: McpCardProps) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState<KeySummary | null>(null);
  const [created, setCreated] = React.useState<{ token: string; name: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>(DEFAULT_SCOPES);
  const [chosen, setChosen] = React.useState<string[]>([currentWorkspaceId]);
  const [days, setDays] = React.useState(90);

  const connected = keys.length > 0;

  function reset() {
    setName("");
    setScopes(DEFAULT_SCOPES);
    setChosen([currentWorkspaceId]);
    setDays(90);
  }

  function toggle(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function submit() {
    startTransition(async () => {
      const result = await createMcpKey({
        name,
        scopes,
        workspaceIds: chosen,
        expiresInDays: days || null,
      });
      if (!result.success) {
        showToast(result.error, { type: "error" });
        return;
      }
      setCreateOpen(false);
      reset();
      // Straight into the reveal — this is the only moment the secret exists.
      setCreated({ token: result.token, name: result.key.name });
    });
  }

  function revoke(key: KeySummary) {
    startTransition(async () => {
      const result = await revokeMcpKey(key.id);
      if (result.success) showToast(`"${key.name}" revoked`, { type: "success" });
      else showToast(result.error, { type: "error" });
      setRevoking(null);
    });
  }

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    showToast(`${what} copied`, { type: "success" });
  }

  const connectCommand = (token: string) =>
    `claude mcp add --scope user --transport http makingflow ${endpoint} --header "Authorization: Bearer ${token}"`;

  return (
    <>
      <CardShell>
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-border bg-muted">
            <Icon name="swap" className="size-5 text-foreground" />
          </div>
          {connected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" />
              {keys.length} connected
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">AI assistants (MCP)</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          {connected
            ? "Claude, Cursor and other AI tools can build forms and read responses for you."
            : "Let Claude, Cursor or any MCP client build forms, publish them and read responses — from wherever you already work."}
        </p>

        {connected ? (
          <ul className="mt-3 space-y-1.5">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{key.name}</span>
                  <span className="block truncate text-muted-foreground">
                    {key.prefix}… · {key.workspaces.length} workspace
                    {key.workspaces.length === 1 ? "" : "s"} ·{" "}
                    {key.lastUsedAt
                      ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                      : "never used"}
                  </span>
                </span>
                {key.mine || canCreate ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setRevoking(key)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          {canCreate ? (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" className="size-4" />
              {connected ? "New connection" : "Connect"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Only owners can create connections
            </span>
          )}
        </div>
      </CardShell>

      {/* ── Create ─────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect an AI assistant</DialogTitle>
            <DialogDescription>
              Creates a key your AI client uses to act on your behalf. You can revoke it at any
              time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="mcp-key-name">Name</Label>
              <Input
                id="mcp-key-name"
                placeholder="Claude Code on my laptop"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                So you can tell your connections apart later.
              </p>
            </div>

            {workspaces.length > 1 ? (
              <div className="space-y-2">
                <Label>Workspaces</Label>
                <div className="space-y-2 rounded-md border border-border p-3">
                  {workspaces.map((w) => (
                    <label key={w.id} className="flex items-center gap-2.5 text-sm">
                      <Checkbox
                        checked={chosen.includes(w.id)}
                        onCheckedChange={() => toggle(chosen, w.id, setChosen)}
                      />
                      <span className="text-foreground">{w.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  One connection can cover several workspaces — you only set it up once.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-2.5 rounded-md border border-border p-3">
                {PERMISSIONS.map((p) => (
                  <label key={p.scope} className="flex items-start gap-2.5 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={scopes.includes(p.scope)}
                      onCheckedChange={() => toggle(scopes, p.scope, setScopes)}
                    />
                    <span className="min-w-0">
                      <span className="block text-foreground">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Deleting forms and responses is never granted here. It stays off by design.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Expires</Label>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((o) => (
                  <Button
                    key={o.days}
                    type="button"
                    size="sm"
                    variant={days === o.days ? "default" : "outline"}
                    onClick={() => setDays(o.days)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={pending || !name.trim() || scopes.length === 0 || chosen.length === 0}
            >
              {pending ? "Creating…" : "Create connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── The one-time reveal ────────────────────────────────────────── */}
      <Dialog open={Boolean(created)} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Connection created</DialogTitle>
            <DialogDescription>
              Copy the command below and run it in your terminal. This is the only time the key is
              shown — we store a one-way hash of it, so it cannot be recovered.
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Connect Claude Code</Label>
                <div className="flex items-start gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed">
                    <code>{connectCommand(created.token)}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(connectCommand(created.token), "Command")}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste it as a single line. A line break inside the quotes puts a newline in the
                  header and the connection fails.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Or just the key</Label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                    {created.token}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(created.token, "Key")}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => setCreated(null)}>I&rsquo;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke ────────────────────────────────────────────────────── */}
      <AlertDialog open={Boolean(revoking)} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &ldquo;{revoking?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using this key stops working immediately. Your forms and responses are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revoking && revoke(revoking)}
              disabled={pending}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
