import React from 'react';
import { cn } from '@/lib/utils';

interface SVGIconProps extends React.HTMLAttributes<HTMLDivElement> {
  src: string;
  /**
   * If true, preserves the original colors of the SVG.
   * If false (default), uses mask mode to allow coloring via text color.
   */
  preserveColors?: boolean;
}

/**
 * A component that renders an SVG.
 * 
 * By default, it renders as a mask, allowing it to be colored
 * using the current text color (or any background color).
 * 
 * Set `preserveColors={true}` to keep the original SVG colors.
 */
export function SVGIcon({ src, className, preserveColors = false, ...props }: SVGIconProps) {
  if (preserveColors) {
    // Render as img to preserve original colors. next/image can't recolor or
    // mask local SVGs the way this primitive needs, so a raw <img> is correct.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn('inline-block shrink-0', className)}
        {...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
      />
    );
  }

  // Default: mask mode for color control
  return (
    <div
      className={cn('bg-current inline-block shrink-0', className)}
      style={{
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
      {...props}
    />
  );
}
