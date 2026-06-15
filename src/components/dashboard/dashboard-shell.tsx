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
import { FormRowMenu } from "@/components/dashboard/form-row-menu";
import { NewFormButton } from "@/components/dashboard/new-form-button";
import { UserNav, type NavWorkspace } from "@/components/dashboard/user-nav";
import { SVGIcon } from "../ui/svg-icon";

const FORMS_IN_SIDEBAR = 10;

export type DashboardShellProps = {
  navItems: DashboardNavItem[];
  forms: FormSummary[];
  user: { email: string; name: string; avatarUrl: string | null };
  workspaces: NavWorkspace[];
  activeWorkspaceId: string | null;
  children: React.ReactNode;
};

export function DashboardShell({
  navItems,
  forms,
  user,
  workspaces,
  activeWorkspaceId,
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
          <SidebarHeader className="h-14 flex-row items-center gap-2 border-b border-border px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <SVGIcon src="/logo/logo.svg" preserveColors className="size-6 shrink-0 rounded" />
            <span className="truncate text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
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
                          className="size-5 shrink-0 group-data-[collapsible=icon]:size-4"
                        />
                        <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">
                          {item.label}
                        </span>
                        {item.comingSoon ? (
                          <span className="shrink-0 rounded border border-sidebar-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground group-data-[collapsible=icon]:hidden">
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
                            <span className="flex w-full min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
                              {inner}
                            </span>
                          ) : (
                            <Link
                              href={item.href!}
                              prefetch
                              className="flex w-full min-w-0 items-center gap-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
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
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
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
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <Icon name="search" className="size-4 shrink-0" />
                  <span>Search forms{forms.length > FORMS_IN_SIDEBAR ? ` (${forms.length})` : ""}</span>
                </button>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-border p-2">
            <UserNav
              user={user}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
            />
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-0 flex-1 overflow-hidden bg-background">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
            <SidebarTrigger />
            <div className="ml-auto flex items-center gap-2">
              <NewFormButton
                className="gradient-border inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground"
                iconClassName="size-4 text-foreground"
              />
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
