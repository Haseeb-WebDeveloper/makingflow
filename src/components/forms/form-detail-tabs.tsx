"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const TABS = [
  // Insights is the index view — served directly at /forms/[id] (no segment).
  { seg: "", label: "Insights" },
  { seg: "submissions", label: "Submissions" },
  { seg: "integrations", label: "Integrations" },
  { seg: "settings", label: "Settings" },
] as const

/** Underlined tab bar across a form's management views. */
export function FormDetailTabs({ formId }: { formId: string }) {
  const pathname = usePathname() ?? ""
  const base = `/forms/${formId}`

  return (
    <nav className="-mb-px mt-4 lg:mt-[1.111vw] flex items-center gap-1 lg:gap-[0.278vw] overflow-x-auto">
      {TABS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base
        const active = t.seg
          ? pathname === href || pathname.endsWith(`/${t.seg}`)
          : pathname === base
        return (
          <Link
            key={t.label}
            href={href}
            prefetch
            className={cn(
              "relative whitespace-nowrap border-b-2 px-3 lg:px-[0.833vw] py-2.5 lg:py-[0.694vw] text-sm lg:text-[0.972vw] font-medium transition-colors",
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
