'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Photo-grid radio selector.
 *
 * Used everywhere a homeowner has to identify something visual but won't
 * know the right vocabulary — siding type, cabinet door style, wall
 * condition, deck condition, drywall damage size. Tapping a picture is
 * faster + more accurate than reading a 7-option dropdown.
 *
 * Image assets live under /public/img/wizard/{topic}/. Generated via
 * Nano Banana per the prompts in the design doc; safe fallback is a
 * neutral placeholder.
 */
export type PhotoGridOption<T extends string> = {
  value: T
  label: string
  /** Path under /public, e.g. '/img/wizard/siding/vinyl.jpg'. */
  img?: string
  /** One short line shown under the label. */
  description?: string
  /** When true, render a warning ribbon (used for thermofoil etc.). */
  warning?: string
}

type Props<T extends string> = {
  options: PhotoGridOption<T>[]
  value: T | null
  onChange: (value: T) => void
  /** Number of columns at sm+. Default 2. */
  columns?: 2 | 3 | 4
  /** ARIA label for the radiogroup. */
  ariaLabel?: string
}

export function PhotoGridSelect<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
  ariaLabel = 'Pick the closest match',
}: Props<T>) {
  const colsClass =
    columns === 4
      ? 'sm:grid-cols-4'
      : columns === 3
        ? 'sm:grid-cols-3'
        : 'sm:grid-cols-2'

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('grid grid-cols-2 gap-3 lg:gap-[12px]', colsClass)}
    >
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'group relative flex flex-col overflow-hidden rounded lg:rounded-[4px] border bg-background text-left outline-none transition-all',
              'hover:border-primary/40 hover:shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2',
              selected
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-border',
            )}
          >
            {/* Image */}
            <div
              className={cn(
                'relative aspect-square w-full overflow-hidden bg-muted',
                selected && 'after:absolute after:inset-0 after:bg-primary/10',
              )}
            >
              {opt.img ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={opt.img}
                  alt={opt.label}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs lg:text-[12px] text-muted-foreground">
                  {opt.label}
                </div>
              )}

              {selected ? (
                <span className="absolute right-2 lg:right-[8px] top-2 lg:top-[8px] z-10 flex size-6 lg:size-[24px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Check className="size-3.5 lg:size-[14px]" />
                </span>
              ) : null}

              {opt.warning ? (
                <span className="absolute inset-x-0 bottom-0 z-10 truncate bg-amber-500/90 px-2 lg:px-[8px] py-1 lg:py-[4px] text-[11px] lg:text-[11px] font-medium text-white">
                  ⚠ {opt.warning}
                </span>
              ) : null}
            </div>

            {/* Caption */}
            <div className="flex flex-col gap-0.5 lg:gap-[2px] px-3 lg:px-[12px] py-2.5 lg:py-[10px]">
              <span
                className={cn(
                  'text-sm lg:text-[14px] font-medium',
                  selected ? 'text-foreground' : 'text-foreground/90',
                )}
              >
                {opt.label}
              </span>
              {opt.description ? (
                <span className="text-xs lg:text-[12px] leading-snug text-muted-foreground">
                  {opt.description}
                </span>
              ) : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}
