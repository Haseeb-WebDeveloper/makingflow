import { Info, AlertTriangle, CheckCircle2, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type BannerVariant = 'info' | 'warning' | 'success' | 'error'

const VARIANT_STYLES: Record<
  BannerVariant,
  { container: string; icon: string }
> = {
  info: {
    container: 'border-primary/20 bg-primary/5 text-foreground',
    icon: 'text-primary',
  },
  warning: {
    container: 'border-amber-500/20 bg-amber-500/5 text-foreground',
    icon: 'text-amber-600',
  },
  success: {
    container: 'border-emerald-500/20 bg-emerald-500/5 text-foreground',
    icon: 'text-emerald-600',
  },
  error: {
    container: 'border-destructive/20 bg-destructive/5 text-foreground',
    icon: 'text-destructive',
  },
}

const VARIANT_ICONS = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  error: XCircle,
} as const

interface StatusBannerProps {
  variant: BannerVariant
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  onDismiss?: () => void
  className?: string
}

export function StatusBanner({
  variant,
  title,
  description,
  action,
  onDismiss,
  className,
}: StatusBannerProps) {
  const styles = VARIANT_STYLES[variant]
  const Icon = VARIANT_ICONS[variant]

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 lg:gap-[0.833vw] rounded-lg lg:rounded-[0.694vw] border px-4 lg:px-[1.111vw] py-3 lg:py-[0.833vw]',
        styles.container,
        className
      )}
    >
      <Icon className={cn('mt-0.5 lg:mt-[0.139vw] size-5 lg:size-[1.389vw] shrink-0', styles.icon)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm lg:text-[0.972vw] font-medium">{title}</p>
        {description && (
          <p className="mt-0.5 lg:mt-[0.139vw] text-sm lg:text-[0.972vw] text-muted-foreground">{description}</p>
        )}
        {action && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 lg:mt-[0.556vw]"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md lg:rounded-[0.556vw] p-0.5 lg:p-[0.139vw] text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="size-4 lg:size-[1.111vw]" />
        </button>
      )}
    </div>
  )
}
