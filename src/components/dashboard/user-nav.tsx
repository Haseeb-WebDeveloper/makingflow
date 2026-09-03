"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import { signOutAction } from "@/lib/actions/auth"
import { switchWorkspace } from "@/lib/actions/workspaces"
import { WorkspaceAvatar } from "@/components/dashboard/workspace-avatar"

export type NavWorkspace = {
  id: string
  name: string
  plan: string
  role: string
  logoUrl: string | null
}

type UserNavProps = {
  user: { email: string; name: string; avatarUrl: string | null }
  workspaces: NavWorkspace[]
  activeWorkspaceId: string | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function UserNav({ user, workspaces, activeWorkspaceId }: UserNavProps) {
  const router = useRouter()
  const [pending, start] = React.useTransition()
  const { theme, setTheme } = useTheme()
  // Defer reading the resolved theme until after hydration (next-themes only
  // knows it client-side). useSyncExternalStore avoids a setState-in-effect.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const currentTheme = mounted ? (theme ?? "system") : "system"

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null

  function select(id: string) {
    if (id === activeWorkspace?.id) return
    start(async () => {
      const res = await switchWorkspace(id)
      if (res.success) {
        router.push("/forms")
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  const avatar = (
    <Avatar className="size-8 shrink-0">
      {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-muted text-xs font-medium text-foreground/70">
        {initials(user.name || user.email)}
      </AvatarFallback>
    </Avatar>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Open account menu"
          className="flex w-full items-center gap-2 rounded-md p-1 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
        >
          {avatar}
          <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-[13px] font-medium text-sidebar-foreground">
              {user.name || "Your account"}
            </span>
            {activeWorkspace ? (
              // Full contrast, like everything else in the rail — the size and
              // weight already say it is the secondary line.
              <span className="truncate text-[11px] text-sidebar-foreground">
                {activeWorkspace.name}
              </span>
            ) : null}
          </span>
          <Icon
            name="swap"
            className="size-3.5 shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
          {avatar}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">
              {user.name || "Your account"}
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {user.email}
            </span>
          </span>
        </DropdownMenuLabel>

        <DropdownMenuItem asChild>
          <Link href="/settings/account" className="flex items-center gap-2">
            <Icon name="setting" className="size-4" />
            Account settings
          </Link>
        </DropdownMenuItem>

        {workspaces.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1.5 text-xs font-normal text-muted-foreground">
              Workspace
            </DropdownMenuLabel>
            {/* Every workspace is one row, the active one included, marked by
                the radio group's tick. Showing the active one as a heading
                instead made it read as a section label rather than a
                workspace — and left it looking less like one than the rows
                underneath it, which had avatars. */}
            <DropdownMenuRadioGroup
              value={activeWorkspace?.id ?? ""}
              onValueChange={select}
            >
              {workspaces.map((w) => (
                <DropdownMenuRadioItem
                  key={w.id}
                  value={w.id}
                  disabled={pending}
                  className="gap-2"
                >
                  <WorkspaceAvatar id={w.id} name={w.name} logoUrl={w.logoUrl} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
                    {w.role}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2">
            <Icon name={currentTheme === "dark" ? "moon" : "sun"} className="size-4" />
            Theme
            {/* <span className="ml-auto text-xs capitalize text-muted-foreground">
              {currentTheme}
            </span> */}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup value={currentTheme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light" className="gap-2">
                <Icon name="sun" className="size-4" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" className="gap-2">
                <Icon name="moon" className="size-4" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" className="gap-2">
                <Icon name="monitor" className="size-4" />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button
              type="submit"
              className="flex w-full items-center gap-2 text-destructive focus:text-destructive"
            >
              <Icon name="logout" className="size-4" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
