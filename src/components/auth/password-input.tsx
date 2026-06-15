"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Icon } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * Password field with a show/hide eye toggle. Forwards every input prop to the
 * shared <Input> (id, name, autoComplete, aria-*, etc.) and only owns the
 * reveal state, so it stays a drop-in replacement for a `type="password"` Input.
 */
export function PasswordInput({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof Input>) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon name={visible ? "hide" : "show"} className="size-5" />
      </button>
    </div>
  )
}
