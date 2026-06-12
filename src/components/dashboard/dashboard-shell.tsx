"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
import { UserMenu } from "@/components/dashboard/user-menu";
import { WorkspaceChip } from "@/components/dashboard/workspace-chip";

export type DashboardShellProps = {
  navItems: DashboardNavItem[];
  user: { email: string; name: string; avatarUrl: string | null };
  workspace: { name: string; plan: string } | null;
  children: React.ReactNode;
};

export function DashboardShell({
  navItems,
  user,
  workspace,
  children,
}: DashboardShellProps) {
  const pathname = usePathname() ?? "";

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider defaultOpen>
        <Sidebar collapsible="icon" variant="sidebar">
          <SidebarHeader className="gap-3 px-3 pb-3 pt-4">
            {workspace ? (
              <WorkspaceChip name={workspace.name} plan={workspace.plan} />
            ) : null}
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const active = isDashboardNavActive(pathname, item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                          className="text-sidebar-foreground/70 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-foreground"
                        >
                          <Link
                            href={item.href}
                            prefetch
                            className="flex w-full min-w-0 items-center gap-2.5"
                          >
                            <Icon
                              name={item.icon}
                              className="size-5 shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {item.label}
                            </span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          {workspace?.plan === "free" ? (
            <SidebarFooter className="px-2 pb-3 group-data-[collapsible=icon]:hidden">
              <div className="rounded-md border border-sidebar-border p-3 bg-background">
                <p className="text-sm font-medium text-sidebar-foreground">
                  You&apos;re on Free
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Unlock more forms, AI, and submissions.
                </p>
                <Link
                  href="/settings/billing"
                  className="mt-2.5 inline-flex h-8 w-full items-center justify-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  Upgrade
                </Link>
              </div>
            </SidebarFooter>
          ) : null}

          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-0 flex-1 overflow-hidden bg-background">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
            <SidebarTrigger />
            <div className="ml-auto flex items-center gap-2">
              <UserMenu user={user} />
            </div>
          </header>

          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
