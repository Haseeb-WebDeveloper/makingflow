"use client"

import type { ComponentProps } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { House01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

export type IconType = ComponentProps<typeof HugeiconsIcon>["icon"]

// Selectable option card: icon + label + optional helper line, with a check that
// fills in when active. Works for single- or multi-select (the parent owns the
// state). Reusable anywhere a "pick from a few rich choices" UI is needed.
export function OptionCard({
  label,
  desc,
  icon,
  active,
  onClick,
  className,
}: {
  label: string
  desc?: string
  icon?: IconType
  active: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group flex items-center gap-3 lg:gap-[12px] rounded-md lg:rounded-[8px] border bg-card px-4 lg:px-[16px] py-3.5 lg:py-[14px] text-left transition-colors active:translate-y-px",
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/30",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-9 lg:size-[36px] shrink-0 items-center justify-center rounded-md lg:rounded-[6px] transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground/55 group-hover:text-foreground/80",
        )}
      >
        <HugeiconsIcon
          icon={icon ?? House01Icon}
          strokeWidth={2}
          className="size-5 lg:size-[18px]"
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm lg:text-[14px] font-semibold text-foreground">
          {label}
        </span>
        {desc && (
          <span className="block text-[13px] lg:text-[12px] leading-snug text-foreground/55">
            {desc}
          </span>
        )}
      </span>

      <span
        className={cn(
          "flex size-5 lg:size-[20px] shrink-0 items-center justify-center rounded-full border transition-colors",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-transparent",
        )}
      >
        <CheckMark />
      </span>
    </button>
  )
}

function CheckMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
