import { Icon, type IconName } from "@/components/ui/icon"

/** Standard content width + padding for every dashboard page. */
export function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl lg:max-w-[80vw] px-6 lg:px-[1.667vw] py-8 lg:py-[2.222vw] sm:px-8">{children}</div>
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
    <div className="flex items-start justify-between gap-4 lg:gap-[1.111vw]">
      <div>
        <h1 className="font-sebenta text-2xl lg:text-[1.667vw] font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 lg:mt-[0.278vw] text-sm lg:text-[0.972vw] text-muted-foreground">{description}</p>
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
    <div className="mt-10 lg:mt-[2.778vw] flex flex-col items-center justify-center rounded-lg lg:rounded-[0.694vw] border border-dashed border-border px-6 lg:px-[1.667vw] py-20 lg:py-[5.556vw] text-center">
      {icon ? (
        <span className="mb-3 lg:mb-[0.833vw] flex size-10 lg:size-[2.778vw] items-center justify-center rounded-md lg:rounded-[0.556vw] bg-muted text-muted-foreground">
          <Icon name={icon} className="size-5 lg:size-[1.389vw]" />
        </span>
      ) : null}
      <p className="text-sm lg:text-[0.972vw] font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 lg:mt-[0.278vw] max-w-sm lg:max-w-[26.667vw] text-sm lg:text-[0.972vw] text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5 lg:mt-[1.389vw]">{action}</div> : null}
    </div>
  )
}
