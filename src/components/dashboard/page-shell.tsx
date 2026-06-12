import { Icon, type IconName } from "@/components/ui/icon"

/** Standard content width + padding for every dashboard page. */
export function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-8">{children}</div>
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-sebenta text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** Centered dashed-border empty state — no shadow, minimal. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: IconName
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mt-10 flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-20 text-center">
      {icon ? (
        <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon name={icon} className="size-5" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
