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
import { showToast } from "@/components/ui/toast";
import { setSheetSharing, setFormSheetSharing } from "@/lib/actions/integrations";
import type { FormAccess } from "@/lib/data/integrations";
import type { SheetShareError } from "@/lib/db/schema";

export type AccessMember = {
  email: string;
  state: "shared" | "blocked" | "failed" | "pending";
  reason: SheetShareError | null;
};

/**
 * What this button governs: one form, or every form in the workspace.
 *
 * `customisedForms` travels with the workspace scope because applying a
 * workspace-wide choice replaces the per-form ones, and the person clicking
 * deserves to know that before they click rather than after.
 */
export type AccessScope =
  | { kind: "form"; formId: string }
  | { kind: "workspace"; customisedForms: number };

type Choice = "off" | "reader" | "writer";

/** The shortest true summary of who can open a spreadsheet. */
function label(access: FormAccess): string {
  if (access.blocked > 0) return `${access.blocked} blocked`;
  if (access.role === null) return "Private";
  if (access.audience === "all") return "All members";
  const n = access.audience?.emails.length ?? 0;
  return `${n} member${n === 1 ? "" : "s"}`;
}

/** Why someone could not be given access, in words rather than a status code. */
function reasonText(reason: SheetShareError | null, ownerEmail?: string): string {
  const domain = ownerEmail?.split("@")[1];
  switch (reason) {
    case "domain_policy":
      return domain ? `${domain} blocks sharing outside the domain` : "blocked by domain policy";
    case "not_a_google_account":
      return "not a Google account";
    default:
      return "failed — try again";
  }
}

/**
 * Who can open a response spreadsheet, as one button.
 *
 * The button carries the answer; the dialog carries the choice. Nothing is
 * explained twice, and the only prose kept is a blocked person's reason — the one
 * thing nobody can act on without being told.
 */
export function AccessButton({
  scope,
  access,
  members,
  accountEmail,
  canManage = true,
}: {
  scope: AccessScope;
  access: FormAccess;
  members: AccessMember[];
  accountEmail?: string;
  canManage?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const attention = access.blocked > 0;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={
          attention
            ? "h-7 px-2 text-xs text-destructive"
            : "h-7 px-2 text-xs text-muted-foreground"
        }
        onClick={() => setOpen(true)}
      >
        {label(access)}
      </Button>

      {open ? (
        <AccessDialog
          onClose={() => setOpen(false)}
          scope={scope}
          access={access}
          members={members}
          accountEmail={accountEmail}
          canManage={canManage}
        />
      ) : null}
    </>
  );
}

/**
 * Mounted only while open, which is also how the checkbox state is seeded from
 * the current audience without an effect that writes state during render.
 */
function AccessDialog({
  onClose,
  scope,
  access,
  members,
  accountEmail,
  canManage,
}: {
  onClose: () => void;
  scope: AccessScope;
  access: FormAccess;
  members: AccessMember[];
  accountEmail?: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [picking, setPicking] = React.useState(false);
  const [ticked, setTicked] = React.useState<string[]>(
    access.audience && access.audience !== "all"
      ? access.audience.emails
      : members.map((m) => m.email)
  );

  const choice: Choice = access.role ?? "off";
  const perForm = scope.kind === "form";
  const customised = scope.kind === "workspace" ? scope.customisedForms : 0;

  function apply(
    action: () => Promise<{ success: boolean; error?: string }>,
    done: string
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        showToast(done, { type: "success" });
        router.refresh();
        onClose();
      } else {
        showToast(res.error ?? "Something went wrong", { type: "error", duration: 12000 });
      }
    });
  }

  /** One place that knows which action a scope writes through. */
  function save(role: "reader" | "writer" | null, audience: "all" | { emails: string[] }) {
    if (perForm) {
      const override = role === null ? ("none" as const) : { role, audience };
      apply(() => setFormSheetSharing(scope.formId, override), "Access updated");
      return;
    }
    apply(
      () => setSheetSharing(role === null ? null : { role, audience }),
      role === null ? "Access removed from every form" : "Access applied to every form"
    );
  }

  const audienceNow = access.audience ?? "all";

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{perForm ? "Access to this sheet" : "Access to every sheet"}</SheetTitle>
          <SheetDescription>
            {perForm && access.source === "workspace"
              ? "Following the workspace setting."
              : accountEmail
                ? `Files live in ${accountEmail}'s Drive.`
                : "Members you choose can open the spreadsheet."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 lg:px-6">
          {customised > 0 ? (
            <p className="rounded-md bg-warning-bg px-3 py-2 text-xs text-warning-foreground">
              {customised} {customised === 1 ? "form is" : "forms are"} customised. Applying
              this replaces {customised === 1 ? "it" : "them"}.
            </p>
          ) : null}

          {canManage ? (
            <div className="flex gap-2">
              {(
                [
                  ["off", "Off"],
                  ["reader", "Viewer"],
                  ["writer", "Editor"],
                ] as const
              ).map(([value, text]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={choice === value ? "default" : "outline"}
                  disabled={pending}
                  onClick={() =>
                    save(value === "off" ? null : value, picking ? { emails: ticked } : audienceNow)
                  }
                >
                  {text}
                </Button>
              ))}
            </div>
          ) : null}

          {choice !== "off" ? (
            <>
              {canManage ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={audienceNow === "all" && !picking ? "default" : "outline"}
                    disabled={pending}
                    onClick={() => {
                      setPicking(false);
                      save(access.role, "all");
                    }}
                  >
                    Everyone
                  </Button>
                  <Button
                    size="sm"
                    variant={audienceNow !== "all" || picking ? "default" : "outline"}
                    disabled={pending || members.length === 0}
                    onClick={() => setPicking(true)}
                  >
                    Choose
                  </Button>
                </div>
              ) : null}

              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.email}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <label className="flex min-w-0 items-center gap-2">
                      {picking && canManage ? (
                        <input
                          type="checkbox"
                          className="size-4 rounded border-border"
                          checked={ticked.includes(m.email)}
                          onChange={(e) =>
                            setTicked((prev) =>
                              e.target.checked
                                ? [...prev, m.email]
                                : prev.filter((x) => x !== m.email)
                            )
                          }
                        />
                      ) : null}
                      <span className="truncate text-foreground">{m.email}</span>
                    </label>
                    {m.state === "blocked" || m.state === "failed" ? (
                      <span className="shrink-0 text-destructive">
                        {reasonText(m.reason, accountEmail)}
                      </span>
                    ) : m.state === "shared" ? (
                      <span className="shrink-0 text-muted-foreground">has access</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex items-center gap-2 border-t border-border p-4 lg:p-6">
            {picking ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => save(access.role ?? "reader", { emails: ticked })}
              >
                Save
              </Button>
            ) : null}
            {perForm && access.source === "form" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  apply(
                    () => setFormSheetSharing(scope.formId, null),
                    "Following the workspace again"
                  )
                }
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
