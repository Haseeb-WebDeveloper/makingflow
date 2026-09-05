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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { CardShell } from "@/components/integrations/cards";
import { createMcpKey, revokeMcpKey } from "@/lib/actions/mcp-keys";
import { disconnectApp } from "@/lib/actions/mcp-oauth";
import { PERMISSION_CHOICES, DEFAULT_SCOPES, scopeLabel } from "@/lib/mcp/scope-catalog";
import type { ConnectedApp } from "@/lib/mcp/oauth/grants";
import type { KeySummary } from "@/lib/core/mcp-keys";

// The permission list lives in @/lib/mcp/scope-catalog, shared with the OAuth
// consent screen. Two copies would drift on the first hurried edit, and the
// failure is quiet: someone reads "Read responses" on one screen and something
// subtly different on the other, and grants what they did not mean to.

const EXPIRY_OPTIONS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "No expiry" },
];

export type McpCardProps = {
  keys: KeySummary[];
  /**
   * Apps connected through OAuth — ChatGPT, claude.ai, anything that
   * authenticates a connector rather than taking a header. Always empty on a
   * deployment with no authorization server configured.
   */
  apps: ConnectedApp[];
  /** Workspaces the viewer belongs to, so one key can cover several. */
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string;
  /** Owners may additionally revoke keys other people created. */
  isOwner: boolean;
  endpoint: string;
};

export function McpCard({
  keys,
  apps,
  workspaces,
  currentWorkspaceId,
  isOwner,
  endpoint,
}: McpCardProps) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState<KeySummary | null>(null);
  const [disconnecting, setDisconnecting] = React.useState<ConnectedApp | null>(null);
  const [created, setCreated] = React.useState<{ token: string; name: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>([...DEFAULT_SCOPES]);
  const [chosen, setChosen] = React.useState<string[]>([currentWorkspaceId]);
  const [days, setDays] = React.useState(90);

  const connected = keys.length + apps.length > 0;

  function reset() {
    setName("");
    setScopes([...DEFAULT_SCOPES]);
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

  function disconnect(app: ConnectedApp) {
    startTransition(async () => {
      const result = await disconnectApp(app.id);
      if (result.success) showToast(`"${app.clientName || "App"}" disconnected`, { type: "success" });
      else showToast(result.error, { type: "error" });
      setDisconnecting(null);
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
              {keys.length + apps.length} connected
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-semibold text-foreground">AI assistants (MCP)</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">
          {connected
            ? "Claude, Cursor and other AI tools can build forms and read responses for you."
            : "Let Claude, Cursor or any MCP client build forms, publish them and read responses — from wherever you already work."}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" className="size-4" />
            {connected ? "New connection" : "Connect"}
          </Button>
          {connected ? (
            <Button size="sm" variant="ghost" onClick={() => setDetailsOpen(true)}>
              View details
            </Button>
          ) : null}
        </div>
      </CardShell>

      {/* ── Connections ────────────────────────────────────────────────── */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="thin-scroll w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>AI assistant connections</SheetTitle>
            <SheetDescription>
              Each connection is a key an AI client uses to act on your behalf. Revoking one takes
              effect on its very next request.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3 px-4 pb-6">
            {/* Apps connected through OAuth — ChatGPT, claude.ai and anything
                else that authenticates a connector rather than taking a header.
                Listed alongside keys because a user does not care which
                mechanism an assistant used; they care what is connected and how
                to stop it. */}
            {apps.length > 0 ? (
              <>
                <p className="pt-1 text-xs font-medium text-muted-foreground">Connected apps</p>
                {apps.map((app) => (
                  <div key={app.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* Chosen by whoever registered the client, so shown as
                            plain text with the id beneath it. */}
                        <p className="truncate text-sm font-medium text-foreground">
                          {app.clientName || "Unnamed app"}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {app.clientId}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDisconnecting(app)}
                      >
                        Disconnect
                      </Button>
                    </div>

                    {/* An app that connected before we knew which app it was:
                        the grant exists but reaches nothing until the user says
                        where. It shows here rather than failing silently in
                        their assistant with nothing to click. */}
                    {app.workspaces.length === 0 ? (
                      <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">
                          This app is connected but can&apos;t reach anything yet. Choose its
                          workspaces and permissions to finish.
                        </p>
                        <Button
                          size="sm"
                          className="mt-2.5"
                          onClick={() => {
                            const url = new URL("/oauth/consent", window.location.origin);
                            url.searchParams.set("client_id", app.clientId);
                            if (app.clientName) url.searchParams.set("client_name", app.clientName);
                            window.location.assign(url.toString());
                          }}
                        >
                          Finish setup
                        </Button>
                      </div>
                    ) : (
                      <dl className="mt-3 space-y-1.5 text-xs">
                        <div className="flex gap-2">
                          <dt className="w-24 shrink-0 text-muted-foreground">Workspaces</dt>
                          <dd className="min-w-0 text-foreground">
                            {app.workspaces.map((w) => w.name).join(", ")}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-24 shrink-0 text-muted-foreground">Permissions</dt>
                          <dd className="min-w-0 text-foreground">
                            {app.scopes.map(scopeLabel).join(", ")}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-24 shrink-0 text-muted-foreground">Last used</dt>
                          <dd className="text-foreground">
                            {app.lastUsedAt ? new Date(app.lastUsedAt).toLocaleString() : "Never"}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </div>
                ))}
                {keys.length > 0 ? (
                  <p className="pt-2 text-xs font-medium text-muted-foreground">API keys</p>
                ) : null}
              </>
            ) : null}

            {keys.map((key) => (
              <div key={key.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{key.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {key.prefix}…
                    </p>
                  </div>
                  {/* Anyone may revoke their own; an owner may revoke any key
                      that reaches this workspace. */}
                  {key.mine || isOwner ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRevoking(key)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>

                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">Workspaces</dt>
                    <dd className="min-w-0 text-foreground">
                      {key.workspaces.map((w) => w.name).join(", ")}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">Permissions</dt>
                    <dd className="min-w-0 text-foreground">
                      {key.scopes
                        .map((s) => scopeLabel(s))
                        .join(", ")}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">Last used</dt>
                    <dd className="text-foreground">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">Expires</dt>
                    <dd className="text-foreground">
                      {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "Never"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Create ─────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="thin-scroll sm:max-w-lg [&>*]:min-w-0">
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
                {PERMISSION_CHOICES.map((p) => (
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
        <DialogContent className="thin-scroll sm:max-w-2xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Connection created</DialogTitle>
            <DialogDescription>
              Copy the command below and run it in your terminal. This is the only time the key is
              shown — we store a one-way hash of it, so it cannot be recovered.
            </DialogDescription>
          </DialogHeader>

          {created ? (
            /*
             * min-w-0 is load-bearing, not defensive tidying. DialogContent is a
             * CSS grid, and grid items default to min-width:auto — so a long
             * unbreakable string like the connect command stretches the track
             * past the dialog's max-width and pushes everything to its right
             * (including the copy buttons) off the screen entirely.
             *
             * The copy button also sits in the LABEL row rather than beside the
             * code block, so it stays put no matter how wide the content is.
             * Copying is the entire point of this dialog; it must never be the
             * thing that scrolls away.
             */
            <div className="min-w-0 space-y-4">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Connect Claude Code</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(connectCommand(created.token), "Command")}
                  >
                    <Icon name="paper" className="size-3.5" />
                    Copy command
                  </Button>
                </div>
                <pre className="w-full thin-scroll overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed">
                  <code>{connectCommand(created.token)}</code>
                </pre>
                <p className="text-xs text-muted-foreground">
                  Paste it as a single line. A line break inside the quotes puts a newline in the
                  header, and the connection fails with an unhelpful error.
                </p>
              </div>

              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Or just the key</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(created.token, "Key")}
                  >
                    <Icon name="paper" className="size-3.5" />
                    Copy key
                  </Button>
                </div>
                <code className="block w-full thin-scroll overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {created.token}
                </code>
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

      <AlertDialog
        open={Boolean(disconnecting)}
        onOpenChange={(open) => !open && setDisconnecting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect &ldquo;{disconnecting?.clientName || "this app"}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It stops working on its very next request, even if it still holds a valid token.
              Your forms and responses are not affected, and you can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnecting && disconnect(disconnecting)}
              disabled={pending}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
