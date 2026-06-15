"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import { switchWorkspace } from "@/lib/actions/team"

const PLAN_LABEL: Record<string, string> = { free: "Free", pro: "Pro", business: "Business" }

export type SwitcherWorkspace = { id: string; name: string; plan: string; role: string }

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: SwitcherWorkspace[]
  activeId: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0]
  if (!active) return null

  function select(id: string) {
    if (id === active.id) return
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Switch workspace"
          className="flex w-full items-center gap-2.5 rounded border border-sidebar-border bg-sidebar-accent px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded bg-foreground text-[11px] font-semibold text-background">
            {active.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {active.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {PLAN_LABEL[active.plan] ?? active.plan} plan
            </span>
          </span>
          <Icon name="swap" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => select(w.id)} className="gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-foreground text-[10px] font-semibold text-background">
              {w.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.id === active.id ? (
              <Icon name="tick-square" className="size-4 shrink-0 text-foreground" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Icon name="setting" className="size-4 text-muted-foreground" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
