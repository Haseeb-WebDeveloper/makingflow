"use client";

/**
 * The consent form: what an app may do, and where.
 *
 * THE APP'S NAME IS UNTRUSTED. It is whatever was written at client
 * registration, and "MakingFlow Official" is the obvious thing to put there. So
 * it is rendered as plain text, never as a link or an image, truncated, and
 * accompanied by the client id — which the user cannot verify either, but which
 * at least differs between a real client and an impostor claiming its name.
 *
 * Defaults are narrow on purpose. Reading responses is off unless the user turns
 * it on, because that is the one that hands respondent PII to a third party, and
 * a pre-ticked box is not a decision anybody made.
 *
 * Every workspace is likewise unchecked. Pre-selecting all of them would be the
 * convenient default and exactly the wrong one: the common case is connecting an
 * assistant to the workspace being worked in, not to every workspace the person
 * has ever joined.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { approveConnection } from "@/lib/actions/mcp-oauth";
import { DEFAULT_SCOPES, PERMISSION_CHOICES } from "@/lib/mcp/scope-catalog";

export type ConsentFormProps = {
  clientId: string;
  clientName: string | null;
  redirectUri: string | null;
  state: string | null;
  workspaces: { id: string; name: string }[];
};

export function ConsentForm({
  clientId,
  clientName,
  redirectUri,
  state,
  workspaces,
}: ConsentFormProps) {
  const [scopes, setScopes] = React.useState<string[]>([...DEFAULT_SCOPES]);
  const [selected, setSelected] = React.useState<string[]>(
    // One workspace means there is nothing to choose, so choosing it is not a
    // dark pattern — it is the only answer.
    workspaces.length === 1 ? [workspaces[0].id] : [],
  );
  const [pending, startTransition] = React.useTransition();

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const canSubmit = scopes.length > 0 && selected.length > 0 && !pending;

  function onApprove() {
    startTransition(async () => {
      const result = await approveConnection({
        clientId,
        clientName,
        scopes,
        workspaceIds: selected,
      });
      if (!result.success) {
        showToast(result.error, { type: "error" });
        return;
      }

      // Hand control back to the authorization server, which finishes the OAuth
      // dance and redirects the client. `state` is echoed untouched — it is the
      // AS's, and mangling it breaks the flow's CSRF protection.
      if (redirectUri) {
        const target = new URL(redirectUri);
        if (state) target.searchParams.set("state", state);
        window.location.assign(target.toString());
        return;
      }
      // No redirect to return to — the user started this from our own settings,
      // so show them the result rather than a dead end.
      window.location.assign("/integrations");
    });
  }

  const displayName = (clientName ?? "").trim().slice(0, 80) || "An application";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-sm font-medium text-foreground">{displayName}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{clientId}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          This name was chosen by the app, not verified by us. Only continue if you started
          this from an app you trust.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">What it may do</legend>
        {PERMISSION_CHOICES.map((p) => (
          <label key={p.scope} className="flex cursor-pointer items-start gap-3">
            <Checkbox
              checked={scopes.includes(p.scope)}
              onCheckedChange={() => setScopes((s) => toggle(s, p.scope))}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                {p.label}
                {p.sensitive ? (
                  <Icon
                    name="danger-circle"
                    className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                    aria-label="Sensitive"
                  />
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">{p.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">
          Which workspaces it may reach
        </legend>
        {workspaces.map((w) => (
          <label key={w.id} className="flex cursor-pointer items-center gap-3">
            <Checkbox
              checked={selected.includes(w.id)}
              onCheckedChange={() => setSelected((s) => toggle(s, w.id))}
            />
            <span className="truncate text-sm text-foreground">{w.name}</span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          Only the workspaces you tick. Joining another one later won&apos;t widen this.
        </p>
      </fieldset>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => window.location.assign("/integrations")}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button className="flex-1" onClick={onApprove} disabled={!canSubmit}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        You can disconnect this app at any time from Integrations.
      </p>
    </div>
  );
}
