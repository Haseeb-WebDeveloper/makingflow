import { cva, type VariantProps } from "class-variance-authority"
import { Icon, type IconName } from "@/components/ui/icon"
import { cn } from "@/lib/utils"

/**
 * An aside the reader should not skim past.
 *
 * Replaces the one on the old webhooks page, which had two defects worth naming
 * because both are easy to reintroduce:
 *
 *   - it rendered a `<p>`, so the moment a callout contained a list or a code
 *     block the markup was invalid — and in MDX, where an author writes
 *     whatever reads best, that is a matter of time rather than of care;
 *   - it had no variants, while its three uses were a security warning, a
 *     "this is the mistake everyone makes", and a neutral note about delivery
 *     semantics. Rendering all three identically spends the reader's attention
 *     evenly on things that do not deserve it evenly.
 */
const calloutVariants = cva(
  "not-prose my-4 flex gap-3 rounded-lg border-l-2 py-3 pl-3.5 pr-4 text-sm [&>div>p]:m-0 [&>div>*+*]:mt-2",
  {
    variants: {
      variant: {
        note: "border-l-border bg-muted/50 text-foreground",
        tip: "border-l-success bg-success-bg/40 text-foreground",
        warning: "border-l-warning bg-warning-bg/40 text-foreground",
        danger: "border-l-destructive bg-destructive-bg/40 text-foreground",
        security: "border-l-primary bg-primary/5 text-foreground",
      },
    },
    defaultVariants: { variant: "note" },
  },
)

const ICONS: Record<NonNullable<VariantProps<typeof calloutVariants>["variant"]>, IconName> = {
  note: "info-square",
  tip: "star",
  warning: "danger-triangle",
  danger: "danger-circle",
  security: "shield-done",
}

export function Callout({
  variant = "note",
  title,
  children,
  className,
}: VariantProps<typeof calloutVariants> & {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const resolved = variant ?? "note"

  return (
    <aside className={cn(calloutVariants({ variant: resolved }), className)}>
      <Icon name={ICONS[resolved]} className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children}
      </div>
    </aside>
  )
}
