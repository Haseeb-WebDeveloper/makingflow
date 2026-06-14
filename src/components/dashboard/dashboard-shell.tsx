"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Icon } from "@/components/ui/icon";
import {
  type DashboardNavItem,
  isDashboardNavActive,
} from "@/components/dashboard/dashboard-nav";
import {
  CommandMenu,
  type FormSummary,
} from "@/components/dashboard/command-menu";
import { UserMenu } from "@/components/dashboard/user-menu";
import { WorkspaceChip } from "@/components/dashboard/workspace-chip";
import { FormRowMenu } from "@/components/dashboard/form-row-menu";
import { SVGIcon } from "../ui/svg-icon";

const FORMS_IN_SIDEBAR = 10;

export type DashboardShellProps = {
  navItems: DashboardNavItem[];
  forms: FormSummary[];
  user: { email: string; name: string; avatarUrl: string | null };
  workspace: { name: string; plan: string } | null;
  children: React.ReactNode;
};

export function DashboardShell({
  navItems,
  forms,
  user,
  workspace,
  children,
}: DashboardShellProps) {
  const pathname = usePathname() ?? "";
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl-K opens the form search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shownForms = forms.slice(0, FORMS_IN_SIDEBAR);

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon" variant="sidebar">
          <SidebarHeader className="h-14 lg:h-[3.889vw] flex-row items-center gap-2 lg:gap-[0.556vw] border-b border-border px-4 lg:px-[1.111vw] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            {/* {workspace ? (
              <WorkspaceChip name={workspace.name} plan={workspace.plan} />
            ) : null} */}
            <SVGIcon src="/logo/logo.svg" preserveColors className="size-6 lg:size-[1.667vw] shrink-0 rounded lg:rounded-[0.324vw]" />
            <span className="truncate text-lg lg:text-[1.25vw] font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              MakingFlow
            </span>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const key = item.href ?? item.label;
                    const active = item.href
                      ? isDashboardNavActive(pathname, item.href)
                      : false;
                    const inner = (
                      <>
                        <Icon
                          name={item.icon}
                          className="size-5 lg:size-[1.389vw] shrink-0 group-data-[collapsible=icon]:size-4"
                        />
                        <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
                          {item.label}
                        </span>
                        {item.comingSoon ? (
                          <span className="shrink-0 rounded lg:rounded-[0.324vw] border border-sidebar-border px-1.5 lg:px-[0.417vw] py-px text-[10px] lg:text-[0.694vw] font-medium uppercase tracking-wide text-muted-foreground group-data-[collapsible=icon]:hidden">
                            Soon
                          </span>
                        ) : null}
                      </>
                    );
                    return (
                      <SidebarMenuItem key={key}>
                        <SidebarMenuButton
                          asChild={!item.action}
                          isActive={active}
                          tooltip={item.label}
                          onClick={
                            item.action === "search"
                              ? () => setSearchOpen(true)
                              : undefined
                          }
                          className="text-sidebar-foreground/70 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-foreground"
                        >
                          {item.action ? (
                            <span className="flex w-full min-w-0 items-center gap-2.5 lg:gap-[0.694vw] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
                              {inner}
                            </span>
                          ) : (
                            <Link
                              href={item.href!}
                              prefetch
                              className="flex w-full min-w-0 items-center gap-2.5 lg:gap-[0.694vw] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                            >
                              {inner}
                            </Link>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel>Forms</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {shownForms.length === 0 ? (
                    <p className="px-2 lg:px-[0.556vw] py-1.5 lg:py-[0.417vw] text-xs lg:text-[0.833vw] text-muted-foreground">
                      No forms yet
                    </p>
                  ) : (
                    shownForms.map((f) => {
                      const active = pathname.startsWith(`/forms/${f.id}`);
                      return (
                        <SidebarMenuItem key={f.id}>
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={f.title || "Untitled form"}
                            className="text-sidebar-foreground/70 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-foreground"
                          >
                            <Link
                              href={`/forms/${f.id}`}
                              prefetch
                              className="flex w-full min-w-0 items-center"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {f.title || "Untitled form"}
                              </span>
                            </Link>
                          </SidebarMenuButton>
                          <FormRowMenu
                            formId={f.id}
                            title={f.title || "Untitled form"}
                            status={f.status}
                            publicId={f.publicId}
                          />
                        </SidebarMenuItem>
                      );
                    })
                  )}
                </SidebarMenu>
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="mt-1 lg:mt-[0.278vw] flex w-full items-center gap-2 lg:gap-[0.556vw] rounded-md lg:rounded-[0.556vw] px-2 lg:px-[0.556vw] py-1.5 lg:py-[0.417vw] text-xs lg:text-[0.833vw] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <Icon name="search" className="size-4 lg:size-[1.111vw] shrink-0" />
                  <span>Search forms{forms.length > FORMS_IN_SIDEBAR ? ` (${forms.length})` : ""}</span>
                </button>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          {workspace?.plan === "free" ? (
            <SidebarFooter className="px-2 lg:px-[0.556vw] pb-3 lg:pb-[0.833vw] group-data-[collapsible=icon]:hidden">
              <div className="rounded-md lg:rounded-[0.556vw] border border-sidebar-border p-3 lg:p-[0.833vw] bg-background">
                <p className="text-sm lg:text-[0.972vw] font-medium text-sidebar-foreground">
                  You&apos;re on Free
                </p>
                <p className="mt-0.5 lg:mt-[0.139vw] text-xs lg:text-[0.833vw] text-muted-foreground">
                  Unlock more forms, AI, and submissions.
                </p>
                <Link
                  href="/settings/billing"
                  className="mt-2.5 lg:mt-[0.694vw] inline-flex h-8 lg:h-[2.222vw] w-full items-center justify-center rounded-md lg:rounded-[0.556vw] bg-foreground px-3 lg:px-[0.833vw] text-xs lg:text-[0.833vw] font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  Upgrade
                </Link>
              </div>
            </SidebarFooter>
          ) : null}

          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-0 flex-1 overflow-hidden bg-background">
          <header className="flex h-14 lg:h-[3.889vw] shrink-0 items-center gap-2 lg:gap-[0.556vw] border-b border-border bg-background px-4 lg:px-[1.111vw]">
            <SidebarTrigger />
            <div className="ml-auto flex items-center gap-2 lg:gap-[0.556vw]">
              <Link
                href="/forms/new"
                prefetch
                className="inline-flex items-center gap-1.5 lg:gap-[0.417vw] rounded-md lg:rounded-[0.556vw] border px-3 lg:px-[0.833vw] py-1.5 lg:py-[0.417vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors"
              >
                <SVGIcon src="/icons/plus.svg" className="size-4 lg:size-[1.111vw] text-foreground" />
                New form
              </Link>
              <UserMenu user={user} />
            </div>
          </header>

          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} forms={forms} />
    </TooltipProvider>
  );
}
