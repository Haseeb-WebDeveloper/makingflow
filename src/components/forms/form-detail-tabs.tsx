"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const TABS = [
  { seg: "insights", label: "Insights" },
  { seg: "submissions", label: "Submissions" },
  { seg: "share", label: "Share" },
  { seg: "integrations", label: "Integrations" },
  { seg: "settings", label: "Settings" },
] as const

/** Underlined tab bar across a form's management views. */
export function FormDetailTabs({ formId }: { formId: string }) {
  const pathname = usePathname() ?? ""

  return (
    <nav className="-mb-px mt-4 flex items-center gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const href = `/forms/${formId}/${t.seg}`
        const active = pathname === href || pathname.endsWith(`/${t.seg}`)
        return (
          <Link
            key={t.seg}
            href={href}
            prefetch
            className={cn(
              "relative whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
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
