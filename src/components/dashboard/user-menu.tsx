"use client"

import * as React from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { Icon } from "@/components/ui/icon"
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
import { signOutAction } from "@/lib/actions/auth"

type UserMenuProps = {
  user: { email: string; name: string; avatarUrl: string | null }
  settingsHref?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function UserMenu({ user, settingsHref = "/settings" }: UserMenuProps) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const currentTheme = mounted ? (theme ?? "system") : "system"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className="flex size-8 lg:size-[2.222vw] items-center justify-center rounded-full outline-none ring-1 ring-border transition-colors hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="h-full w-full">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-muted text-xs lg:text-[0.833vw] font-medium text-foreground/70">
              {initials(user.name || user.email)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64 lg:w-[17.778vw]">
        <DropdownMenuLabel className="flex flex-col gap-0.5 lg:gap-[0.139vw] py-2 lg:py-[0.556vw]">
          <span className="truncate text-sm lg:text-[0.972vw] font-semibold text-foreground">
            {user.name || "Your account"}
          </span>
          <span className="truncate text-xs lg:text-[0.833vw] font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={settingsHref} className="flex items-center gap-2 lg:gap-[0.556vw]">
            <Icon name="setting" className="size-4 lg:size-[1.111vw]" />
            Account settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2 lg:gap-[0.556vw]">
            <Icon name={currentTheme === "dark" ? "moon" : "sun"} className="size-4 lg:size-[1.111vw]" />
            Theme
            <span className="ml-auto text-xs lg:text-[0.833vw] capitalize text-muted-foreground">
              {currentTheme}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44 lg:w-[12.222vw]">
            <DropdownMenuRadioGroup value={currentTheme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light" className="gap-2 lg:gap-[0.556vw]">
                <Icon name="sun" className="size-4 lg:size-[1.111vw]" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" className="gap-2 lg:gap-[0.556vw]">
                <Icon name="moon" className="size-4 lg:size-[1.111vw]" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" className="gap-2 lg:gap-[0.556vw]">
                <Icon name="monitor" className="size-4 lg:size-[1.111vw]" />
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
              className="flex w-full items-center gap-2 lg:gap-[0.556vw] text-destructive focus:text-destructive"
            >
              <Icon name="logout" className="size-4 lg:size-[1.111vw]" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
