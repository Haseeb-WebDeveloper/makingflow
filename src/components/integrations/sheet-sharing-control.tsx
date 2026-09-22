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
import { setSheetSharing, reconcileSheetSharing } from "@/lib/actions/integrations";
import type { WorkspaceIntegrations } from "@/lib/data/integrations";
import type { SheetShareError } from "@/lib/db/schema";

type Sharing = WorkspaceIntegrations["sharing"];
type Choice = "off" | "reader" | "writer";

/** The chosen state as one of three words, so the button group has one source. */
function choiceOf(sharing: Sharing): Choice {
  if (!sharing.setting) return "off";
  return sharing.setting.role;
}

/**
 * Why someone is missing, in words.
 *
 * "403" explains nothing to the person reading this, and a member who cannot be
 * given access must never render as though they have it.
 */
function reasonText(reason: SheetShareError | null, ownerEmail: string): string {
  const domain = ownerEmail.split("@")[1] ?? "this account";
  switch (reason) {
    case "domain_policy":
      return `${domain} does not allow sharing outside the domain`;
    case "not_a_google_account":
      return "not a Google account";
    default:
      return "could not be shared — try again";
  }
}

/**
 * Who in the workspace can open the response spreadsheets.
 *
 * The files live in ONE person's Drive — the fact people get wrong about this
 * integration — so the account is named on screen rather than implied.
 */
export function SheetSharingControl({
  sharing,
  accountEmail,
  canManage,
}: {
  sharing: Sharing;
  accountEmail: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const choice = choiceOf(sharing);
  const audience = sharing.setting?.audience ?? "all";
  const everyone = audience === "all";
  const needsAttention = sharing.members.some(
    (m) => m.state === "blocked" || m.state === "failed"
  );

  function run(
    action: () => Promise<{ success: boolean; error?: string }>,
    done: string
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.success) {
        showToast(done, { type: "success" });
        router.refresh();
      } else {
        showToast(res.error ?? "Something went wrong", {
          type: "error",
          duration: 12000,
        });
      }
    });
  }

  function choose(next: Choice) {
    if (next === choice) return;
    if (next === "off") {
      run(() => setSheetSharing(null), "Members no longer have access");
      return;
    }
    run(
      () => setSheetSharing({ role: next, audience }),
      next === "reader"
        ? "Members can view the spreadsheets"
        : "Members can edit the spreadsheets"
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <h4 className="text-sm font-medium text-foreground">
        Give members access to response spreadsheets
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Files live in {accountEmail}&apos;s Google Drive.
      </p>

      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["off", "Off"],
              ["reader", "Viewer"],
              ["writer", "Editor"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={choice === value ? "default" : "outline"}
              disabled={pending}
              onClick={() => choose(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      {choice === "off" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Only {accountEmail} can open these spreadsheets.
        </p>
      ) : (
        <>
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={everyone ? "default" : "outline"}
                disabled={pending}
                onClick={() =>
                  run(
                    () => setSheetSharing({ role: choice, audience: "all" }),
                    "Every member gets access"
                  )
                }
              >
                All members
              </Button>
              <Button
                size="sm"
                variant={everyone ? "outline" : "default"}
                disabled={pending || sharing.members.length === 0}
                onClick={() => setPickerOpen(true)}
              >
                Only selected…
              </Button>
            </div>
          ) : null}

          <ul className="mt-3 space-y-1.5">
            {sharing.members.map((m) => (
              <li
                key={m.email}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="truncate text-foreground">{m.email}</span>
                <span
                  className={
                    m.state === "shared" || m.state === "pending"
                      ? "shrink-0 text-muted-foreground"
                      : "shrink-0 text-destructive"
                  }
                >
                  {m.state === "shared"
                    ? `shared · ${m.sheets} ${
                        m.sheets === 1 ? "spreadsheet" : "spreadsheets"
                      }`
                    : m.state === "pending"
                      ? "not shared yet"
                      : reasonText(m.reason, accountEmail)}
                </span>
              </li>
            ))}
          </ul>

          {canManage && needsAttention ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={pending}
              onClick={() => run(() => reconcileSheetSharing(), "Access re-checked")}
            >
              Re-check access
            </Button>
          ) : null}
        </>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Every member can already read responses inside MakingFlow — this is for
        people who work in Sheets.
      </p>

      <MemberPicker
        // Remounting on each open is what re-seeds the ticks.
        key={pickerOpen ? "picker-open" : "picker-closed"}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        members={sharing.members}
        role={choice === "off" ? "reader" : choice}
        pending={pending}
        onSave={(emails) => {
          setPickerOpen(false);
          run(
            () =>
              setSheetSharing({
                role: choice === "off" ? "reader" : choice,
                audience: { emails },
              }),
            "Access updated"
          );
        }}
      />
    </div>
  );
}

/**
 * Choosing which members get access.
 *
 * Pre-ticked from who already has it, deliberately: an empty list revokes
 * everyone, and submitting an empty list by accident is exactly the click
 * somebody makes while finding out what this button does.
 */
function MemberPicker({
  open,
  onOpenChange,
  members,
  role,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Sharing["members"];
  role: "reader" | "writer";
  pending: boolean;
  onSave: (emails: string[]) => void;
}) {
  const initial = React.useMemo(
    () => members.filter((m) => m.state !== "pending").map((m) => m.email),
    [members]
  );
  // Seeded once per mount. The caller remounts this on open (see the key below),
  // so each visit starts from the current truth rather than from whatever was
  // left ticked last time — without an effect that writes state during render.
  const [ticked, setTicked] = React.useState<string[]>(initial);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Who gets access</SheetTitle>
          <SheetDescription>
            The people you tick can open every form&apos;s spreadsheet as{" "}
            {role === "reader" ? "a viewer" : "an editor"}.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 lg:px-6">
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.email}>
                <label className="flex items-center gap-2 text-sm text-foreground">
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
                  <span className="truncate">{m.email}</span>
                </label>
              </li>
            ))}
          </ul>
          {ticked.length === 0 ? (
            <p className="mt-3 text-xs text-destructive">
              Nobody ticked — saving this removes every member&apos;s access.
            </p>
          ) : null}
        </div>

        <div className="border-t border-border p-4 lg:p-6">
          <Button size="sm" disabled={pending} onClick={() => onSave(ticked)}>
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
