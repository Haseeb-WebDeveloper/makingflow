import { CldImage, type CldImageProps } from 'next-cloudinary'
import { cn } from '@/lib/utils'

type CloudImageProps = Omit<CldImageProps, 'config'> & {
  className?: string
}

/**
 * Project-wide wrapper around CldImage (next-cloudinary).
 *
 * - Applies `f_auto/q_auto` by default (CldImage does this automatically)
 * - Sets a default `sizes` if not provided to avoid LCP regressions
 * - Keeps import paths consistent across the codebase
 */
export function CloudImage({
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
  className,
  ...props
}: CloudImageProps) {
  return (
    <CldImage
      sizes={sizes}
      className={cn(className)}
      {...props}
    />
  )
}
