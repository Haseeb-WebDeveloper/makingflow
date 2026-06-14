"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { MAKINGFLOW_NAV } from "@/components/dashboard/dashboard-nav";
import { recordRecentForm, useRecentForms } from "@/lib/hooks/use-recent-forms";
import { SVGIcon } from "../ui/svg-icon";

export type FormSummary = { id: string; title: string; status: string; publicId?: string };

const STATUS_STYLES: Record<string, string> = {
  published: "bg-success/10 text-success",
  draft: "bg-muted text-muted-foreground",
  closed: "bg-destructive/10 text-destructive",
  archived: "bg-muted text-muted-foreground",
};

// Top-level destinations (skip the Search action item — it's this dialog).
const PAGES = MAKINGFLOW_NAV.filter((n) => n.href && !n.action);

/**
 * Global command palette (⌘K): fuzzy-search across forms, pages, and quick
 * actions. All client-side over already-loaded data, so it's instant. Recent
 * forms surface when the box is empty.
 */
export function CommandMenu({
  open,
  onOpenChange,
  forms,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forms: FormSummary[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const recent = useRecentForms();

  // Reset the query when the palette closes, so it reopens fresh.
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };

  const go = (href: string) => {
    handleOpenChange(false);
    router.push(href);
  };
  const goForm = (f: { id: string; title: string }) => {
    recordRecentForm(f);
    go(`/forms/${f.id}`);
  };

  const showRecent = query.trim() === "" && recent.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Search"
      description="Search forms, pages, and actions"
      className="sm:max-w-xl"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search forms, pages, actions…"
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No results found.</CommandEmpty>

        {showRecent ? (
          <CommandGroup heading="Recent">
            {recent.map((r) => (
              <CommandItem
                key={`recent-${r.id}`}
                value={`recent-${r.id} ${r.title}`}
                onSelect={() => goForm(r)}
              >
                <Icon
                  name="document"
                  className="size-4 lg:size-[1.111vw] text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">
                  {r.title || "Untitled form"}
                </span>
                <Icon
                  name="time-circle"
                  className="size-3.5 lg:size-[0.972vw] text-muted-foreground/60"
                />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Quick actions">
          <CommandItem
            value="New form create build"
            onSelect={() => go("/forms/new")}
          >
            <span className="grid size-5 lg:size-[1.389vw] shrink-0 place-items-center rounded lg:rounded-[0.324vw] bg-primary/10 text-primary">
              <SVGIcon src="/icons/plus.svg" className="size-3.5 lg:size-[0.972vw]" />
            </span>
            <span className="min-w-0 flex-1 truncate">New form</span>
          </CommandItem>
        </CommandGroup>

        {forms.length > 0 ? (
          <CommandGroup heading="Forms">
            {forms.map((f) => (
              <CommandItem
                key={f.id}
                value={`${f.title} ${f.id}`}
                onSelect={() => goForm(f)}
              >
                <Icon
                  name="document"
                  className="size-4 lg:size-[1.111vw] text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">
                  {f.title || "Untitled form"}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-[11px] lg:text-[0.764vw] font-medium capitalize ${
                    STATUS_STYLES[f.status] ?? STATUS_STYLES.draft
                  }`}
                >
                  {f.status}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.href}
              value={p.label}
              onSelect={() => go(p.href!)}
            >
              <Icon name={p.icon} className="size-4 lg:size-[1.111vw] text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              {p.comingSoon ? (
                <span className="shrink-0 rounded lg:rounded-[0.324vw] border border-border px-1.5 lg:px-[0.417vw] py-px text-[10px] lg:text-[0.694vw] font-medium uppercase tracking-wide text-muted-foreground">
                  Soon
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>

      <div className="flex items-center gap-3 lg:gap-[0.833vw] border-t border-border px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-[11px] lg:text-[0.764vw] text-muted-foreground">
        <span className="flex items-center gap-1 lg:gap-[0.278vw]">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1 lg:gap-[0.278vw]">
          <Kbd>↵</Kbd>
          Open
        </span>
        <span className="flex items-center gap-1 lg:gap-[0.278vw]">
          <Kbd>esc</Kbd>
          Close
        </span>
      </div>
    </CommandDialog>
  );
}
