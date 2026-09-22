"use client";

import * as React from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

/**
 * /sandbox/access — dev-only gallery of designs for "who can open this form's
 * response spreadsheet", so we can pick one before wiring it up. Version A is
 * what's live today; B–D are alternatives. Not linked from anywhere.
 *
 * Every version is interactive and holds its own local state — nothing here
 * calls a server action, so clicking around cannot share a real file with
 * anybody.
 */

// ── The shape every version renders ─────────────────────────────────────────

type Member = { email: string; blocked?: boolean };
type Access =
  | { kind: "everyone" }
  | { kind: "some"; emails: string[] }
  | { kind: "private" }
  | { kind: "inherit" };

const MEMBERS: Member[] = [
  { email: "garima.m@figmenta.com" },
  { email: "admin@figmenta.com" },
  { email: "haseeb.figmenta@gmail.com", blocked: true },
];

const FORMS = [
  { id: "f1", title: "Junior Frontend Developer – India" },
  { id: "f2", title: "Monthly Feedback Form" },
  { id: "f3", title: "Meta Paid Advertising Specialist" },
];

const OWNER = "garima.m@figmenta.com";

/** Initials for an avatar chip. */
function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

/** The shortest true summary of an access state. */
function summary(a: Access, workspace: Access): string {
  const eff = a.kind === "inherit" ? workspace : a;
  switch (eff.kind) {
    case "everyone":
      return "Everyone";
    case "some":
      return `${eff.emails.length} ${eff.emails.length === 1 ? "person" : "people"}`;
    default:
      return "Private";
  }
}

function peopleOf(a: Access, workspace: Access): Member[] {
  const eff = a.kind === "inherit" ? workspace : a;
  if (eff.kind === "everyone") return MEMBERS.filter((m) => m.email !== OWNER);
  if (eff.kind === "some")
    return MEMBERS.filter((m) => eff.emails.includes(m.email) && m.email !== OWNER);
  return [];
}

export default function AccessSandbox() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Sheet access — versions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who can open a form&apos;s response spreadsheet. Each version shows the
          workspace-wide control at the top and three forms under it, the way the
          Sheets panel does. All interactive; nothing is saved.
        </p>
      </header>

      <div className="space-y-12">
        <Version
          name="Version A — Text button + side sheet"
          note="Live today. The label is the answer; a side sheet holds the choice."
        >
          <VariantA />
        </Version>

        <Version
          name="Version B — Faces"
          note="Who, not how many. The stack is the control: click it to change. Drive and Figma both work this way, so there is nothing to learn."
        >
          <VariantB />
        </Version>

        <Version
          name="Version C — Inline, no dialog"
          note="Everything editable in the row itself. Fastest when setting several forms in a row; densest."
        >
          <VariantC />
        </Version>

        <Version
          name="Version D — One share dialog"
          note="Google's own share dialog: people with a role each, and a general-access line at the bottom. Most familiar, most screen."
        >
          <VariantD />
        </Version>
      </div>
    </div>
  );
}

// ── Version A: what is live now ─────────────────────────────────────────────

function VariantA() {
  const [workspace, setWorkspace] = React.useState<Access>({ kind: "everyone" });
  const [perForm, setPerForm] = React.useState<Record<string, Access>>({
    f1: { kind: "inherit" },
    f2: { kind: "some", emails: ["admin@figmenta.com"] },
    f3: { kind: "inherit" },
  });
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  return (
    <PanelShell>
      <Row label="Access to every sheet" bordered>
        <button
          type="button"
          onClick={() => setOpenFor("__ws")}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {summary(workspace, workspace)}
        </button>
      </Row>

      {FORMS.map((f) => {
        const access = perForm[f.id];
        const blocked = peopleOf(access, workspace).some((m) => m.blocked);
        return (
          <FormRow key={f.id} title={f.title}>
            <button
              type="button"
              onClick={() => setOpenFor(f.id)}
              className={`rounded px-2 py-1 text-xs hover:bg-muted ${
                blocked ? "text-destructive" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {blocked ? "1 blocked" : summary(access, workspace)}
            </button>
          </FormRow>
        );
      })}

      {openFor ? (
        <FakeSideSheet
          title={openFor === "__ws" ? "Access to every sheet" : "Access to this sheet"}
          subtitle={
            openFor !== "__ws" && perForm[openFor]?.kind === "inherit"
              ? "Following the workspace setting."
              : `Files live in ${OWNER}'s Drive.`
          }
          onClose={() => setOpenFor(null)}
        >
          <div className="flex gap-2">
            {(["private", "everyone"] as const).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={
                  (openFor === "__ws" ? workspace.kind : perForm[openFor]?.kind) === k
                    ? "default"
                    : "outline"
                }
                onClick={() => {
                  const next: Access = k === "private" ? { kind: "private" } : { kind: "everyone" };
                  if (openFor === "__ws") setWorkspace(next);
                  else setPerForm((p) => ({ ...p, [openFor]: next }));
                }}
              >
                {k === "private" ? "Off" : "Viewer"}
              </Button>
            ))}
            <Button size="sm" variant="outline">
              Editor
            </Button>
          </div>
          <ul className="mt-4 space-y-2">
            {MEMBERS.filter((m) => m.email !== OWNER).map((m) => (
              <li key={m.email} className="flex justify-between gap-3 text-xs">
                <span className="truncate text-foreground">{m.email}</span>
                <span className={m.blocked ? "text-destructive" : "text-muted-foreground"}>
                  {m.blocked ? "figmenta.com blocks outside sharing" : "has access"}
                </span>
              </li>
            ))}
          </ul>
        </FakeSideSheet>
      ) : null}
    </PanelShell>
  );
}

// ── Version B: faces ────────────────────────────────────────────────────────

function VariantB() {
  const [workspace, setWorkspace] = React.useState<Access>({ kind: "everyone" });
  const [perForm, setPerForm] = React.useState<Record<string, Access>>({
    f1: { kind: "inherit" },
    f2: { kind: "some", emails: ["admin@figmenta.com"] },
    f3: { kind: "private" },
  });
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  function set(id: string, next: Access) {
    if (id === "__ws") setWorkspace(next);
    else setPerForm((p) => ({ ...p, [id]: next }));
  }

  return (
    <PanelShell>
      <Row label="Everyone in the workspace" bordered>
        <Faces
          people={peopleOf(workspace, workspace)}
          onClick={() => setOpenFor("__ws")}
          inherit={false}
        />
      </Row>

      {FORMS.map((f) => (
        <FormRow key={f.id} title={f.title}>
          <Faces
            people={peopleOf(perForm[f.id], workspace)}
            onClick={() => setOpenFor(f.id)}
            inherit={perForm[f.id]?.kind === "inherit"}
          />
        </FormRow>
      ))}

      {openFor ? (
        <FakePopover onClose={() => setOpenFor(null)}>
          <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {openFor === "__ws" ? "Every sheet" : "This sheet only"}
          </p>
          {MEMBERS.filter((m) => m.email !== OWNER).map((m) => {
            const current = openFor === "__ws" ? workspace : perForm[openFor];
            const has = peopleOf(current, workspace).some((p) => p.email === m.email);
            return (
              <button
                key={m.email}
                type="button"
                onClick={() => {
                  const people = peopleOf(current, workspace).map((p) => p.email);
                  const emails = has
                    ? people.filter((e) => e !== m.email)
                    : [...people, m.email];
                  set(openFor, emails.length ? { kind: "some", emails } : { kind: "private" });
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-xs hover:bg-muted"
              >
                <Avatar email={m.email} />
                <span className="min-w-0 flex-1 truncate text-foreground">{m.email}</span>
                {m.blocked ? (
                  <Icon name="danger-triangle" className="size-3.5 text-destructive" />
                ) : has ? (
                  <Icon name="tick-square" className="size-3.5 text-success" />
                ) : null}
              </button>
            );
          })}
          <div className="mt-1.5 flex gap-1.5 border-t border-border pt-2">
            <MiniButton onClick={() => set(openFor, { kind: "everyone" })}>Everyone</MiniButton>
            <MiniButton onClick={() => set(openFor, { kind: "private" })}>Nobody</MiniButton>
            {openFor !== "__ws" ? (
              <MiniButton onClick={() => set(openFor, { kind: "inherit" })}>
                Follow workspace
              </MiniButton>
            ) : null}
          </div>
        </FakePopover>
      ) : null}
    </PanelShell>
  );
}

function Faces({
  people,
  onClick,
  inherit,
}: {
  people: Member[];
  onClick: () => void;
  inherit: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted"
      title={people.map((p) => p.email).join(", ") || "Nobody"}
    >
      {people.length === 0 ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Icon name="lock" className="size-3.5" />
          Private
        </span>
      ) : (
        <span className="flex -space-x-1.5">
          {people.slice(0, 3).map((p) => (
            <Avatar key={p.email} email={p.email} ring danger={p.blocked} />
          ))}
          {people.length > 3 ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-canvas">
              +{people.length - 3}
            </span>
          ) : null}
        </span>
      )}
      <Icon
        name="add-user"
        className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
      {inherit ? (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">shared</span>
      ) : null}
    </button>
  );
}

// ── Version C: inline, no dialog ────────────────────────────────────────────

function VariantC() {
  const [workspace, setWorkspace] = React.useState<Access>({ kind: "everyone" });
  const [perForm, setPerForm] = React.useState<Record<string, Access>>({
    f1: { kind: "inherit" },
    f2: { kind: "some", emails: ["admin@figmenta.com"] },
    f3: { kind: "inherit" },
  });

  return (
    <PanelShell>
      <Row label="Access to every sheet" bordered>
        <div className="flex items-center gap-2">
          <Segmented
            value={workspace.kind === "private" ? "off" : "view"}
            onChange={(v) =>
              setWorkspace(v === "off" ? { kind: "private" } : { kind: "everyone" })
            }
          />
          <Chip>{summary(workspace, workspace)}</Chip>
        </div>
      </Row>

      {FORMS.map((f) => {
        const a = perForm[f.id];
        const eff = a.kind === "inherit" ? workspace : a;
        return (
          <FormRow key={f.id} title={f.title}>
            <div className="flex items-center gap-2">
              <Segmented
                value={eff.kind === "private" ? "off" : "view"}
                onChange={(v) =>
                  setPerForm((p) => ({
                    ...p,
                    [f.id]: v === "off" ? { kind: "private" } : { kind: "everyone" },
                  }))
                }
              />
              <button
                type="button"
                onClick={() =>
                  setPerForm((p) => ({
                    ...p,
                    [f.id]:
                      a.kind === "inherit"
                        ? { kind: "some", emails: ["admin@figmenta.com"] }
                        : { kind: "inherit" },
                  }))
                }
              >
                <Chip muted={a.kind === "inherit"}>
                  {a.kind === "inherit" ? "inherited" : summary(a, workspace)}
                </Chip>
              </button>
            </div>
          </FormRow>
        );
      })}
      <p className="px-3 pt-2 text-[11px] text-muted-foreground">
        Click the chip to switch between the workspace setting and this form&apos;s own.
      </p>
    </PanelShell>
  );
}

function Segmented({
  value,
  onChange,
}: {
  value: "off" | "view" | "edit";
  onChange: (v: "off" | "view" | "edit") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {(["off", "view", "edit"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2 py-0.5 text-[11px] font-medium capitalize ${
            value === v
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ── Version D: Google's share dialog ────────────────────────────────────────

function VariantD() {
  const [open, setOpen] = React.useState<string | null>(null);
  const [roles, setRoles] = React.useState<Record<string, "viewer" | "editor" | "none">>({
    "admin@figmenta.com": "viewer",
    "haseeb.figmenta@gmail.com": "none",
  });
  const [general, setGeneral] = React.useState<"restricted" | "workspace">("workspace");

  return (
    <PanelShell>
      <Row label="Access to every sheet" bordered>
        <MiniButton onClick={() => setOpen("__ws")}>
          <Icon name="add-user" className="size-3.5" />
          Share
        </MiniButton>
      </Row>

      {FORMS.map((f) => (
        <FormRow key={f.id} title={f.title}>
          <MiniButton onClick={() => setOpen(f.id)}>
            <Icon name="add-user" className="size-3.5" />
            Share
          </MiniButton>
        </FormRow>
      ))}

      {open ? (
        <FakeModal onClose={() => setOpen(null)}>
          <h4 className="text-sm font-semibold text-foreground">
            {open === "__ws" ? "Share every sheet" : "Share this sheet"}
          </h4>
          <ul className="mt-4 space-y-3">
            <li className="flex items-center gap-2.5">
              <Avatar email={OWNER} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{OWNER}</p>
                <p className="text-[11px] text-muted-foreground">Owner of the files</p>
              </div>
              <span className="text-[11px] text-muted-foreground">Owner</span>
            </li>
            {MEMBERS.filter((m) => m.email !== OWNER).map((m) => (
              <li key={m.email} className="flex items-center gap-2.5">
                <Avatar email={m.email} danger={m.blocked} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{m.email}</p>
                  {m.blocked ? (
                    <p className="text-[11px] text-destructive">
                      figmenta.com blocks sharing outside the domain
                    </p>
                  ) : null}
                </div>
                <select
                  value={roles[m.email] ?? "none"}
                  onChange={(e) =>
                    setRoles((r) => ({
                      ...r,
                      [m.email]: e.target.value as "viewer" | "editor" | "none",
                    }))
                  }
                  className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
                >
                  <option value="none">No access</option>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              General access
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Icon
                name={general === "workspace" ? "unlock" : "lock"}
                className="size-4 text-muted-foreground"
              />
              <select
                value={general}
                onChange={(e) => setGeneral(e.target.value as "restricted" | "workspace")}
                className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
              >
                <option value="restricted">Restricted — only people above</option>
                <option value="workspace">Anyone in this workspace</option>
              </select>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Button size="sm" onClick={() => setOpen(null)}>
              Done
            </Button>
          </div>
        </FakeModal>
      ) : null}
    </PanelShell>
  );
}

// ── Shared preview scaffolding ──────────────────────────────────────────────

function Version({
  name,
  note,
  children,
}: {
  name: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">{name}</h2>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}

/** A stand-in for the Sheets details panel, so each version is judged in place. */
function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border border-border bg-canvas p-3">{children}</div>
  );
}

function Row({
  label,
  bordered,
  children,
}: {
  label: string;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
        bordered ? "border border-border bg-background" : ""
      }`}
    >
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

function FormRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{title}</p>
        <span className="text-[11px] text-muted-foreground">Syncing</span>
      </div>
      {children}
    </div>
  );
}

function Avatar({
  email,
  ring,
  danger,
}: {
  email: string;
  ring?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
        danger ? "bg-destructive/15 text-destructive" : "bg-muted text-foreground"
      } ${ring ? "ring-2 ring-canvas" : ""}`}
    >
      {initials(email)}
    </span>
  );
}

function Chip({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        muted
          ? "border-dashed border-border text-muted-foreground"
          : "border-border text-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function MiniButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      {children}
    </button>
  );
}

/** Stand-ins for the real Sheet/Dialog, so the sandbox needs no portals. */
function FakeSideSheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function FakePopover({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 w-full max-w-xs rounded-lg border border-border bg-background p-2 shadow-sm">
      {children}
      <button
        type="button"
        onClick={onClose}
        className="mt-2 w-full rounded px-1 py-1 text-[11px] text-muted-foreground hover:bg-muted"
      >
        Close
      </button>
    </div>
  );
}

function FakeModal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-4 shadow-sm">
      {children}
      <button
        type="button"
        onClick={onClose}
        className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        Close
      </button>
    </div>
  );
}
