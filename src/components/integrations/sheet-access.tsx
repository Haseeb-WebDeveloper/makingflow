"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { setSheetSharing, setFormSheetSharing } from "@/lib/actions/integrations";
import type { AccessMemberState, FormAccess } from "@/lib/data/integrations";
import type { SheetShareError, SheetSharingSetting } from "@/lib/db/schema";

/**
 * What a Share button governs: one form, or every form in the workspace.
 *
 * `customisedForms` travels with the workspace scope because applying a
 * workspace-wide choice replaces the per-form ones, and the person clicking
 * deserves to know that before they click rather than after.
 */
export type AccessScope =
  | { kind: "form"; formId: string }
  | { kind: "workspace"; customisedForms: number };

type Role = "reader" | "writer" | "none";

/** Initials, for the avatar beside each address. */
function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

/** Why someone could not be given access, in words rather than a status code. */
function reasonText(reason: SheetShareError | null, accountEmail: string): string {
  const domain = accountEmail.split("@")[1];
  switch (reason) {
    case "domain_policy":
      return domain
        ? `${domain} blocks sharing outside the domain`
        : "blocked by domain policy";
    case "not_a_google_account":
      return "not a Google account";
    default:
      return "couldn’t be shared — try again";
  }
}

/**
 * The Share button, and the dialog behind it.
 *
 * Deliberately Google's own shape: people with a role each, then one general
 * access line. It is the dialog everybody has already used for exactly this
 * decision, so there is nothing here to learn — and the role select per person is
 * what lets one teammate edit while the rest only look.
 *
 * The trigger carries one piece of state and no more: a warning dot when somebody
 * could not be given access, because that is the only thing you cannot discover
 * by opening the dialog yourself.
 */
export function ShareButton({
  scope,
  access,
  members,
  accountEmail,
  canManage = true,
  label = "Share",
}: {
  scope: AccessScope;
  access: FormAccess;
  members: AccessMemberState[];
  accountEmail: string;
  canManage?: boolean;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <Icon name="add-user" className="size-3.5" />
        {label}
        {access.blocked > 0 ? (
          <span
            aria-label={`${access.blocked} blocked`}
            className="size-1.5 rounded-full bg-destructive"
          />
        ) : null}
      </Button>

      {open ? (
        <ShareDialog
          scope={scope}
          access={access}
          members={members}
          accountEmail={accountEmail}
          canManage={canManage}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Mounted only while open, which is also how the draft below is seeded from the
 * current state without an effect that writes state during render.
 */
function ShareDialog({
  scope,
  access,
  members,
  accountEmail,
  canManage,
  onClose,
}: {
  scope: AccessScope;
  access: FormAccess;
  members: AccessMemberState[];
  accountEmail: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // The dialog is a draft: nothing is written until Save, so a half-made change
  // cannot leave somebody sharing a file they did not mean to share.
  const [general, setGeneral] = React.useState<"reader" | "writer" | null>(access.general);
  const [roles, setRoles] = React.useState<Record<string, Role>>(() =>
    Object.fromEntries(members.map((m) => [m.email, m.role])),
  );

  const perForm = scope.kind === "form";
  const customised = scope.kind === "workspace" ? scope.customisedForms : 0;
  const inheriting = perForm && access.source === "workspace";

  const dirty =
    general !== access.general ||
    members.some((m) => (roles[m.email] ?? "none") !== m.role);

  function save(setting: SheetSharingSetting | null, done: string) {
    startTransition(async () => {
      const res = perForm
        ? await setFormSheetSharing((scope as { formId: string }).formId, setting)
        : await setSheetSharing(setting);
      if (res.success) {
        showToast(done, { type: "success" });
        router.refresh();
        onClose();
      } else {
        showToast(res.error ?? "Something went wrong", { type: "error", duration: 12000 });
      }
    });
  }

  function saveDraft() {
    // Only the people who differ from the general line are worth storing; the
    // rest follow it, so a later membership change carries them automatically.
    const people = members
      .map((m) => ({ email: m.email, role: roles[m.email] ?? "none" }))
      .filter((p) => p.role !== (general ?? "none"));
    save(
      { general, ...(people.length ? { people } : {}) },
      perForm ? "Access updated" : "Access updated on every sheet",
    );
  }

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{perForm ? "Share this sheet" : "Share every sheet"}</SheetTitle>
          <SheetDescription>
            {inheriting
              ? "Following the workspace setting."
              : `Files live in ${accountEmail}’s Drive.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 lg:px-6">
          {customised > 0 ? (
            <p className="rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
              {customised} {customised === 1 ? "form has" : "forms have"} its own access.
              Saving here replaces {customised === 1 ? "it" : "them"}.
            </p>
          ) : null}

          <ul className="space-y-3">
            <li className="flex items-center gap-2.5">
              <Avatar email={accountEmail} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{accountEmail}</p>
                <p className="text-[11px] text-muted-foreground">Owns the files</p>
              </div>
              <span className="text-[11px] text-muted-foreground">Owner</span>
            </li>

            {members.map((m) => {
              const role = roles[m.email] ?? "none";
              return (
                <li key={m.email} className="flex items-center gap-2.5">
                  <Avatar email={m.email} danger={m.state === "blocked"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{m.email}</p>
                    {m.state === "blocked" || m.state === "failed" ? (
                      <p className="text-[11px] text-destructive">
                        {reasonText(m.reason, accountEmail)}
                      </p>
                    ) : m.state === "pending" && role !== "none" ? (
                      <p className="text-[11px] text-muted-foreground">not shared yet</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <select
                      aria-label={`Access for ${m.email}`}
                      value={role}
                      disabled={pending}
                      onChange={(e) =>
                        setRoles((r) => ({ ...r, [m.email]: e.target.value as Role }))
                      }
                      className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
                    >
                      <option value="none">No access</option>
                      <option value="reader">Viewer</option>
                      <option value="writer">Editor</option>
                    </select>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {role === "none" ? "No access" : role === "reader" ? "Viewer" : "Editor"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border pt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              General access
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Icon
                name={general ? "unlock" : "lock"}
                className="size-4 text-muted-foreground"
              />
              {canManage ? (
                <select
                  aria-label="General access"
                  value={general ?? "restricted"}
                  disabled={pending}
                  onChange={(e) =>
                    setGeneral(
                      e.target.value === "restricted"
                        ? null
                        : (e.target.value as "reader" | "writer"),
                    )
                  }
                  className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                >
                  <option value="restricted">Restricted — only people above</option>
                  <option value="reader">Everyone in the workspace can view</option>
                  <option value="writer">Everyone in the workspace can edit</option>
                </select>
              ) : (
                <span className="text-xs text-foreground">
                  {general === null
                    ? "Restricted"
                    : general === "reader"
                      ? "Everyone in the workspace can view"
                      : "Everyone in the workspace can edit"}
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Members can always read responses in MakingFlow — this is Drive access.
            </p>
          </div>
        </div>

        {canManage ? (
          <div className="flex items-center justify-between gap-2 border-t border-border p-4 lg:p-6">
            <Button size="sm" disabled={pending || !dirty} onClick={saveDraft}>
              Save
            </Button>
            {perForm && access.source === "form" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => save(null, "Following the workspace again")}
              >
                Follow workspace
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Avatar({ email, danger }: { email: string; danger?: boolean }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
        danger ? "bg-destructive/15 text-destructive" : "bg-muted text-foreground"
      }`}
    >
      {initials(email)}
    </span>
  );
}
