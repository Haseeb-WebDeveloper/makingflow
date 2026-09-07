"use client";

/**
 * The "Connect an AI assistant" card, and the flow behind it.
 *
 * IT ASKS WHICH APP FIRST, and that is the whole design. There are two ways to
 * connect and they are not interchangeable: the chat assistants speak only
 * OAuth and have nowhere to put a key, while Claude Code, Cursor and VS Code
 * take a header and need one. Before this asked, everyone got a key and a Claude Code
 * command — which meant a ChatGPT user received a credential their client
 * cannot accept, with nothing erroring and no way to finish. The answer decides
 * whether there is anything to do here at all, so it has to come first.
 *
 * For OAuth clients the honest answer is "nothing to set up here", said out
 * loud, with the URL to paste into their settings. No key is minted and no
 * permissions are asked, because those are chosen on the consent screen when
 * the app sends the user back to us.
 *
 * For key clients, the secret is shown ONCE and cannot be recovered — the
 * database holds only an HMAC. That is a real constraint, not a UI preference,
 * so the reveal is a deliberate stop rather than a line of text to scroll past.
 * Where the client supports a one-click install (Cursor, VS Code) it is offered
 * first: the single most common way this flow has broken is a token pasted
 * across two lines, which puts a newline in the HTTP header, and a deeplink
 * removes that failure mode rather than warning about it.
 *
 * Per-app copy lives in @/lib/mcp/client-catalog, shared with the public docs
 * page so setup instructions cannot drift between the two.
 */

import * as React from "react";
import dynamic from "next/dynamic";
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
import { SVGIcon } from "@/components/ui/svg-icon";
import { createMcpKey, revokeMcpKey } from "@/lib/actions/mcp-keys";
import { disconnectApp } from "@/lib/actions/mcp-oauth";
import {
  PERMISSION_CHOICES,
  DEFAULT_SCOPES,
  scopeLabel,
} from "@/lib/mcp/scope-catalog";
import { MCP_CLIENTS, type McpClientInfo } from "@/lib/mcp/client-catalog";
import type { ConnectedApp } from "@/lib/mcp/oauth/grants";
import type { KeySummary } from "@/lib/core/mcp-keys";

// The permission list lives in @/lib/mcp/scope-catalog, shared with the OAuth
// consent screen. Two copies would drift on the first hurried edit, and the
// failure is quiet: someone reads "Read responses" on one screen and something
// subtly different on the other, and grants what they did not mean to.

// The dotLottie player pulls a WASM runtime. It is decorative here, so keep it
// out of the integrations page's initial JS entirely.
const Lottie = dynamic(
  () => import("@/components/builder/lottie").then((m) => m.Lottie),
  { ssr: false },
);

/**
 * Whether the viewport is lg or wider.
 *
 * Starts false and settles after mount, which is correct for this use: the
 * animation is decorative, so a frame without it costs nothing, and the
 * alternative — guessing during SSR — would render a player on phones.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

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
  // The connect flow is a small state machine: pick an app, then either follow
  // its OAuth steps or create a key and install it. `client` is what says which
  // branch we are on, so it drives which dialog is open.
  const [createOpen, setCreateOpen] = React.useState(false);
  const [client, setClient] = React.useState<McpClientInfo | null>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState<KeySummary | null>(null);
  const [disconnecting, setDisconnecting] = React.useState<ConnectedApp | null>(
    null,
  );
  const [created, setCreated] = React.useState<{
    token: string;
    name: string;
  } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>([...DEFAULT_SCOPES]);
  const [chosen, setChosen] = React.useState<string[]>([currentWorkspaceId]);
  const [days, setDays] = React.useState(90);

  const connected = keys.length + apps.length > 0;
  const isDesktop = useIsDesktop();

  function reset() {
    setName("");
    setScopes([...DEFAULT_SCOPES]);
    setChosen([currentWorkspaceId]);
    setDays(90);
  }

  function toggle(
    list: string[],
    value: string,
    set: (next: string[]) => void,
  ) {
    set(
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
    );
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
      if (result.success)
        showToast(`"${key.name}" revoked`, { type: "success" });
      else showToast(result.error, { type: "error" });
      setRevoking(null);
    });
  }

  function disconnect(app: ConnectedApp) {
    startTransition(async () => {
      const result = await disconnectApp(app.id);
      if (result.success)
        showToast(`"${app.clientName || "App"}" disconnected`, {
          type: "success",
        });
      else showToast(result.error, { type: "error" });
      setDisconnecting(null);
    });
  }

  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    showToast(`${what} copied`, { type: "success" });
  }

  /**
   * Enter the flow for one app. Reached from the panel's logo pills as well as
   * the picker, so the pre-naming lives here rather than in a click handler.
   */
  function pick(c: McpClientInfo) {
    setClient(c);
    setCreateOpen(true);
    // Pre-named after the app they picked. The field exists so connections can
    // be told apart later, and "Cursor" is a better default than an empty box
    // the user has to invent something for.
    if (c.method === "api-key") setName(c.name);
  }

  /** Leave the whole flow, whichever step it is on. */
  function closeCreate() {
    setCreateOpen(false);
    setClient(null);
    setCreated(null);
    reset();
  }

  // Install instructions for the app the user actually picked. Built here
  // rather than in the catalogue because it needs the token, which exists only
  // in this one render after creation.
  const guide =
    created && client?.install
      ? client.install({ endpoint, token: created.token })
      : null;

  return (
    <>
      {/* ── The panel ──────────────────────────────────────────────────
          Full width, rather than one tile in the integrations grid. MCP is not
          a peer of "send an email on submit": it is a second way to drive the
          entire product, so it reads as a surface of its own.

          ONE COLUMN, not two. The earlier version boxed the URL and both
          buttons into a floating card on the right, which read as a widget
          bolted onto a banner: it fought the headline for attention, squeezed
          two buttons into a narrow column, and pushed the logos into an ugly
          wrap. Now everything runs on one axis — say what it is, give the URL,
          then a footer strip of the apps it works with. Nothing floats.

          THE COLOURS DO NOT FOLLOW THE THEME, and that is deliberate. The
          background is a fixed image in both light and dark, so everything on
          it is white-alpha rather than the usual `--background` tokens — a
          token that inverts would go black-on-near-black in dark mode.

          `bg-[#141636]` is not redundant with the image: it is what shows while
          a 500KB jpg is still loading, and white text on an unpainted panel is
          invisible. The scrim is light because the image is already dark
          everywhere — even its vivid blue sits near 0.06 luminance, so white
          clears 9:1 on it. It exists to even out the bright lower-left corner,
          not to rescue the contrast.

          The logos are clickable: picking your app is the first thing the flow
          asks anyway, so a pill skips a step rather than decorating one. */}
      <section
        className="relative overflow-hidden rounded-2xl bg-[#141636] bg-cover bg-center text-white"
        style={{ backgroundImage: "url('/mcp-bg.jpg')" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/40 via-black/15 to-transparent"
        />

        <div className="relative p-7 sm:p-10">
          {/* The upper half. The ornament is anchored to THIS block rather than
              the panel, so it stops at the divider instead of running the full
              height, and the reserved gutter (lg:pr-*) ends here too — which is
              what lets the rule and the logo strip below span edge to edge. */}
          <div className="relative lg:pr-[19rem]">
            {/* Decorative, desktop only. Gated on a media query rather than
                `hidden lg:block`, because a CSS-hidden player still downloads
                its chunk and boots the WASM runtime on a phone that will never
                show it.

                Sized to the box rather than a fixed `size-*`: the block's
                height moves with how the paragraph wraps, and a fixed square
                would spill past the divider at some widths. dotLottie letter-
                boxes inside whatever it is given, so h-full can't distort it. */}
            {isDesktop ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 hidden w-[19rem] lg:block"
              >
                <Lottie name="robot" className="h-full w-full" />
              </div>
            ) : null}

            <h2 className="max-w-2xl text-2xl font-semibold leading-[1.2] tracking-tight sm:text-[2rem]">
              Bring MakingFlow into your AI assistant
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/90 sm:text-[0.9375rem]">
              Connect Claude, ChatGPT, Cursor or any MCP client to this
              workspace. It can build forms, publish them, read responses and
              answer questions about how they are performing — from wherever you
              already work.
            </p>

            {/* Both actions on one line, add before manage. Manage only exists
                once there is something to manage, so on an empty workspace this
                is a single unambiguous button rather than a choice. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                className="h-10 shrink-0 bg-white px-5 text-[#141636] hover:bg-white/90"
                onClick={() => setCreateOpen(true)}
              >
                <Icon name="plus" className="size-4" />
                {connected ? "New connection" : "Connect an assistant"}
              </Button>

              {connected ? (
                <Button
                  variant="ghost"
                  className="h-10 shrink-0 border border-white/25 bg-white/10 px-5 text-white backdrop-blur-sm hover:bg-white/20 hover:text-white"
                  onClick={() => setDetailsOpen(true)}
                >
                  Manage {keys.length + apps.length} connection
                  {keys.length + apps.length === 1 ? "" : "s"}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-2 border-t border-white/15 pt-6">
            {MCP_CLIENTS.filter((c) => c.id !== "other").map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                title={`Connect ${c.name}`}
                className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 py-1.5 pl-1.5 pr-3.5 text-xs font-medium backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/20"
              >
                <SVGIcon
                  src={c.icon}
                  preserveColors={c.preserveColors}
                  className="size-5 rounded"
                  aria-hidden
                />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Connections ────────────────────────────────────────────────── */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent
          side="right"
          className="thin-scroll w-full overflow-y-auto sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle>AI assistant connections</SheetTitle>
            <SheetDescription>
              Each connection is a key an AI client uses to act on your behalf.
              Revoking one takes effect on its very next request.
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
                <p className="pt-1 text-xs font-medium text-muted-foreground">
                  Connected apps
                </p>
                {apps.map((app) => (
                  <div
                    key={app.id}
                    className="rounded-lg border border-border p-3"
                  >
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

                    <dl className="mt-3 space-y-1.5 text-xs">
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted-foreground">
                          Workspaces
                        </dt>
                        <dd className="min-w-0 text-foreground">
                          {app.workspaces.map((w) => w.name).join(", ")}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted-foreground">
                          Permissions
                        </dt>
                        <dd className="min-w-0 text-foreground">
                          {app.scopes.map(scopeLabel).join(", ")}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-24 shrink-0 text-muted-foreground">
                          Last used
                        </dt>
                        <dd className="text-foreground">
                          {app.lastUsedAt
                            ? new Date(app.lastUsedAt).toLocaleString()
                            : "Never"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
                {keys.length > 0 ? (
                  <p className="pt-2 text-xs font-medium text-muted-foreground">
                    API keys
                  </p>
                ) : null}
              </>
            ) : null}

            {keys.map((key) => (
              <div key={key.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {key.name}
                    </p>
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
                    <dt className="w-24 shrink-0 text-muted-foreground">
                      Workspaces
                    </dt>
                    <dd className="min-w-0 text-foreground">
                      {key.workspaces.map((w) => w.name).join(", ")}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">
                      Permissions
                    </dt>
                    <dd className="min-w-0 text-foreground">
                      {key.scopes.map((s) => scopeLabel(s)).join(", ")}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">
                      Last used
                    </dt>
                    <dd className="text-foreground">
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleString()
                        : "Never"}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-muted-foreground">
                      Expires
                    </dt>
                    <dd className="text-foreground">
                      {key.expiresAt
                        ? new Date(key.expiresAt).toLocaleDateString()
                        : "Never"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Step 1: which app? ─────────────────────────────────────────
          Asked FIRST because the answer decides whether there is anything to
          do here at all. The chat assistants cannot accept a key — their flow
          starts in their own settings — so handing them one is a dead end the
          user cannot detect: nothing errors, and there is no way to finish. */}
      <Dialog open={createOpen && !client} onOpenChange={closeCreate}>
        <DialogContent className="thin-scroll sm:max-w-2xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Where do you want to use MakingFlow?</DialogTitle>
            <DialogDescription>
              How you connect depends on the app. Pick yours and we&rsquo;ll
              show the steps for it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3  sm:grid-cols-3">
            {MCP_CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="rounded-lg border border-border p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50"
              >
                <SVGIcon
                  src={c.icon}
                  preserveColors={c.preserveColors}
                  className="size-8 rounded-md"
                  aria-hidden
                />
                <span className="mt-2.5 block text-sm font-medium text-foreground">
                  {c.name}
                </span>
                <span className="mt-0.5 h-full block text-xs leading-snug text-muted-foreground">
                  {c.blurb}
                </span>
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Not sure? The chat assistants sign in with your MakingFlow account.
            Everything else uses a key you create here.
          </p>
        </DialogContent>
      </Dialog>

      {/* ── Step 2A: an OAuth client — nothing to set up here ───────────
          Said out loud, because a user who came looking for a button will
          otherwise keep hunting for one. No key is minted and no permissions
          are asked: those are chosen on the consent screen, mid-flow, once
          the app sends them back to us. */}
      <Dialog
        open={Boolean(client && client.method === "oauth")}
        onOpenChange={closeCreate}
      >
        <DialogContent className="thin-scroll sm:max-w-lg [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Connect {client?.name}</DialogTitle>
            <DialogDescription>
              Nothing to set up here — {client?.name} starts the connection from
              its own settings.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4">
            <ol className="space-y-2.5 text-sm text-muted-foreground">
              {client?.steps?.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>

            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Server URL</Label>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => copy(endpoint, "URL")}
                >
                  <Icon name="paper" className="size-3.5" />
                  Copy URL
                </Button>
              </div>
              <code className="block w-full thin-scroll overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
                {endpoint}
              </code>
            </div>

            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              You&rsquo;ll choose which workspaces and permissions{" "}
              {client?.name} gets when it sends you back here to sign in.
              Nothing is granted until you do.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setClient(null)}>
              Back
            </Button>
            <Button onClick={closeCreate}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Step 2B: a client that takes a key ─────────────────────────── */}
      <Dialog
        open={Boolean(client && client.method === "api-key" && !created)}
        onOpenChange={closeCreate}
      >
        <DialogContent className="thin-scroll sm:max-w-lg [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Connect {client?.name}</DialogTitle>
            <DialogDescription>
              Creates a key {client?.name} uses to act on your behalf. You can
              revoke it at any time.
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
                    <label
                      key={w.id}
                      className="flex items-center gap-2.5 text-sm"
                    >
                      <Checkbox
                        checked={chosen.includes(w.id)}
                        onCheckedChange={() => toggle(chosen, w.id, setChosen)}
                      />
                      <span className="text-foreground">{w.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  One connection can cover several workspaces — you only set it
                  up once.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-2.5 rounded-md border border-border p-3">
                {PERMISSION_CHOICES.map((p) => (
                  <label
                    key={p.scope}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={scopes.includes(p.scope)}
                      onCheckedChange={() => toggle(scopes, p.scope, setScopes)}
                    />
                    <span className="min-w-0">
                      <span className="block text-foreground">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Deleting forms and responses is never granted here. It stays off
                by design.
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
            <Button
              variant="outline"
              onClick={() => setClient(null)}
              disabled={pending}
            >
              Back
            </Button>
            <Button
              onClick={submit}
              disabled={
                pending ||
                !name.trim() ||
                scopes.length === 0 ||
                chosen.length === 0
              }
            >
              {pending ? "Creating…" : "Create connection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── The one-time reveal ────────────────────────────────────────── */}
      <Dialog
        open={Boolean(created)}
        onOpenChange={(open) => !open && setCreated(null)}
      >
        <DialogContent className="thin-scroll sm:max-w-2xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Connection created</DialogTitle>
            <DialogDescription>
              Copy the command below and run it in your terminal. This is the
              only time the key is shown — we store a one-way hash of it, so it
              cannot be recovered.
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
              {guide?.deeplink ? (
                /*
                 * One click, where the client offers it. This removes the whole
                 * class of paste errors the note below warns about — which has
                 * been the single most common way this flow breaks.
                 *
                 * The copyable config still sits underneath, never behind a
                 * disclosure: a protocol handler is exactly the sort of thing
                 * that silently does not fire, and a user whose button did
                 * nothing must not be left with nothing.
                 */
                <Button asChild className="w-full">
                  <a href={guide.deeplink}>
                    <Icon name="swap" className="size-4" />
                    {guide.deeplinkLabel}
                  </a>
                </Button>
              ) : null}

              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>
                    {guide?.deeplink
                      ? "Or paste this configuration"
                      : `Connect ${client?.name ?? "your client"}`}
                  </Label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => copy(guide?.code ?? "", "Configuration")}
                  >
                    <Icon name="paper" className="size-3.5" />
                    Copy
                  </Button>
                </div>
                <pre className="w-full thin-scroll overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed">
                  <code>{guide?.code}</code>
                </pre>
                {guide?.note ? (
                  <p className="text-xs text-muted-foreground">{guide.note}</p>
                ) : null}
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
            <Button onClick={() => setCreated(null)}>
              I&rsquo;ve saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke ────────────────────────────────────────────────────── */}
      <AlertDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke &ldquo;{revoking?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Anything using this key stops working immediately. Your forms and
              responses are not affected.
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
              Disconnect &ldquo;{disconnecting?.clientName || "this app"}
              &rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It stops working on its very next request, even if it still holds
              a valid token. Your forms and responses are not affected, and you
              can reconnect at any time.
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
