"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { showToast } from "@/components/ui/toast";
import { setSheetSharing, setFormSheetSharing } from "@/lib/actions/integrations";
import type { AccessMemberState, FormAccess } from "@/lib/data/integrations";
import type { SheetShareError, SheetSharingSetting } from "@/lib/db/schema";

/**
 * What a Share button governs: one form, or every form in the workspace.
 *
 * `customisedForms` travels with the workspace scope because saving a
 * workspace-wide choice replaces the per-form ones, and the person clicking
 * deserves to know that before they click rather than after.
 */
export type AccessScope =
  | { kind: "form"; formId: string }
  | { kind: "workspace"; customisedForms: number };

/** What a person's own dropdown can say. `inherit` = whatever everyone gets. */
type PersonChoice = "inherit" | "reader" | "writer" | "none";

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

/** Why someone could not be given access, in words rather than a status code. */
function reasonText(reason: SheetShareError | null, accountEmail: string): string {
  const domain = accountEmail.split("@")[1];
  switch (reason) {
    case "domain_policy":
      return domain ? `${domain} blocks sharing outside the domain` : "blocked by policy";
    case "not_a_google_account":
      return "not a Google account";
    default:
      return "couldn’t be shared — try again";
  }
}

/** The one-line answer for the row the button sits in. */
export function accessSummary(access: FormAccess): string {
  if (access.blocked > 0) {
    return `${access.blocked} blocked`;
  }
  if (access.general) {
    const excluded = access.people.filter((p) => p.role === "none").length;
    return excluded ? `Everyone except ${excluded}` : "Everyone";
  }
  const named = access.people.filter((p) => p.role !== "none").length;
  if (named === 0) return "Private";
  return `${named} ${named === 1 ? "person" : "people"}`;
}

/**
 * What the dialog would store, given what is on screen.
 *
 * Pure and exported, because this is the rule that decides who ends up with
 * access — worth reading and testing without a rendered dialog in the way.
 *
 * "Same as everyone" is stored as NOTHING, and so is anyone whose role already
 * matches the general line: a member added to the workspace later is then carried
 * by that line instead of being silently left out of every sheet.
 */
export function buildSharingSetting(input: {
  audience: "everyone" | "chosen";
  everyoneRole: "reader" | "writer";
  choices: Record<string, PersonChoice>;
  members: { email: string }[];
}): SheetSharingSetting {
  const general = input.audience === "everyone" ? input.everyoneRole : null;
  const people = input.members
    .map((m) => ({ email: m.email, role: input.choices[m.email] ?? "inherit" }))
    .filter(
      (p): p is { email: string; role: "reader" | "writer" | "none" } =>
        p.role !== "inherit" && p.role !== (general ?? "none"),
    );
  return { general, ...(people.length ? { people } : {}) };
}

/**
 * Who can open a response spreadsheet.
 *
 * The button says how things stand; the dialog is where they change. The
 * dialog asks ONE question first — everyone, or only chosen people — and only
 * then talks about roles, because "general access" alongside a list of people
 * with their own roles is the part nobody could read.
 */
export function ShareButton({
  scope,
  access,
  members,
  accountEmail,
  canManage = true,
}: {
  scope: AccessScope;
  access: FormAccess;
  members: AccessMemberState[];
  accountEmail: string;
  canManage?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Icon name="add-user" className="size-3.5" />
        Share
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
 * Mounted only while open, which is how the draft below is seeded from the
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

  // A draft: nothing is written until Save, so a half-made change cannot leave
  // somebody sharing a file they did not mean to share.
  const [audience, setAudience] = React.useState<"everyone" | "chosen">(
    access.general ? "everyone" : "chosen",
  );
  const [everyoneRole, setEveryoneRole] = React.useState<"reader" | "writer">(
    access.general ?? "reader",
  );
  const [choices, setChoices] = React.useState<Record<string, PersonChoice>>(() =>
    Object.fromEntries(
      members.map((m) => {
        const own = access.people.find(
          (p) => p.email.toLowerCase() === m.email.toLowerCase(),
        );
        return [m.email, own ? own.role : access.general ? "inherit" : "none"];
      }),
    ),
  );

  const perForm = scope.kind === "form";
  const customised = scope.kind === "workspace" ? scope.customisedForms : 0;
  const inheriting = perForm && access.source === "workspace";

  const next = buildSharingSetting({ audience, everyoneRole, choices, members });
  const dirty =
    next.general !== access.general ||
    JSON.stringify(next.people ?? []) !== JSON.stringify(access.people ?? []);

  function write(setting: SheetSharingSetting | null, done: string) {
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

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{perForm ? "Share this spreadsheet" : "Share every spreadsheet"}</DialogTitle>
          <DialogDescription>
            {inheriting
              ? `Following the workspace setting. Files live in ${accountEmail}’s Drive.`
              : `Files live in ${accountEmail}’s Drive.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {customised > 0 ? (
            <p className="rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
              {customised} {customised === 1 ? "form has" : "forms have"} their own
              sharing. Saving here replaces {customised === 1 ? "it" : "them"}.
            </p>
          ) : null}

          {/* ── One question first, then roles. Asking both at once is what
                made the old "General access" line unreadable.

                Somebody who cannot change any of this gets a sentence, not a
                row of controls they are not allowed to touch. ── */}
          {!canManage ? (
            <p className="rounded-lg border border-border px-3 py-2.5 text-sm text-foreground">
              {audience === "everyone"
                ? `Everyone in the workspace can ${everyoneRole === "writer" ? "edit" : "view"}`
                : "Only chosen people"}
            </p>
          ) : (
          <RadioGroup
            value={audience}
            onValueChange={(v) => setAudience(v as "everyone" | "chosen")}
            className="gap-2"
            disabled={pending}
          >
            <label className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
              <RadioGroupItem value="everyone" id="aud-everyone" />
              <span className="flex-1 text-sm text-foreground">Everyone in the workspace</span>
              {audience === "everyone" ? (
                <Select
                  value={everyoneRole}
                  onValueChange={(v) => setEveryoneRole(v as "reader" | "writer")}
                  disabled={!canManage || pending}
                >
                  <SelectTrigger size="sm" className="w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reader">Can view</SelectItem>
                    <SelectItem value="writer">Can edit</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </label>

            <label className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
              <RadioGroupItem value="chosen" id="aud-chosen" />
              <span className="flex-1 text-sm text-foreground">Only the people I choose</span>
            </label>
          </RadioGroup>
          )}

          {/* ── The people. Each dropdown says what THIS person gets, with
                "Same as everyone" naming the inheritance out loud. ── */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              People
            </p>
            <ul className="space-y-2.5">
              <li className="flex items-center gap-3">
                <Avatar email={accountEmail} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{accountEmail}</p>
                  <p className="text-xs text-muted-foreground">Owns the files</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">Owner</span>
              </li>

              {members.map((m) => {
                const choice = choices[m.email] ?? "inherit";
                return (
                  <li key={m.email} className="flex items-center gap-3">
                    <Avatar email={m.email} danger={m.state === "blocked"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{m.email}</p>
                      {m.state === "blocked" || m.state === "failed" ? (
                        <p className="text-xs text-destructive">
                          {reasonText(m.reason, accountEmail)}
                        </p>
                      ) : m.state === "shared" ? (
                        <p className="text-xs text-muted-foreground">Has access</p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <Select
                        value={choice}
                        onValueChange={(v) =>
                          setChoices((c) => ({ ...c, [m.email]: v as PersonChoice }))
                        }
                        disabled={pending}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-[145px] shrink-0 text-xs"
                          aria-label={`Access for ${m.email}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {audience === "everyone" ? (
                            <SelectItem value="inherit">Same as everyone</SelectItem>
                          ) : null}
                          <SelectItem value="reader">Can view</SelectItem>
                          <SelectItem value="writer">Can edit</SelectItem>
                          <SelectItem value="none">No access</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {choice === "none"
                          ? "No access"
                          : choice === "writer"
                            ? "Can edit"
                            : "Can view"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Members can always read responses inside MakingFlow. This is Google Drive
            access to the spreadsheet itself.
          </p>
        </div>

        {canManage ? (
          <DialogFooter className="sm:justify-between">
            {perForm && access.source === "form" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => write(null, "Following the workspace again")}
              >
                Follow workspace
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={pending || !dirty}
                onClick={() =>
                  write(next, perForm ? "Sharing updated" : "Sharing updated on every sheet")
                }
              >
                Save
              </Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Avatar({ email, danger }: { email: string; danger?: boolean }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        danger ? "bg-destructive/15 text-destructive" : "bg-muted text-foreground"
      }`}
    >
      {initials(email)}
    </span>
  );
}
