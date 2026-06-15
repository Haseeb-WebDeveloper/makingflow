"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Shared "AI is working" indicator. Rotates through a few short status lines
 * instead of a static spinner so the wait reads as steady progress, and the
 * text is the same size/weight as the answer it becomes (so the bubble doesn't
 * jump or feel heavier when the real text lands). Used by every AI surface:
 * the conversational form fill, the form-detail Ask-AI sheet, and the builder.
 *
 * Pass the phrase set that fits the surface. The first line lingers ~1.5s, the
 * rest ~2.6s, and it holds on the last line until the real response streams in.
 */
export function Thinking({
  phrases,
  className,
}: {
  phrases: string[]
  className?: string
}) {
  const [i, setI] = useState(0)

  useEffect(() => {
    if (i >= phrases.length - 1) return // hold on the last line until the reply arrives
    const delay = i === 0 ? 1500 : 2600
    const t = setTimeout(() => setI((n) => n + 1), delay)
    return () => clearTimeout(t)
  }, [i, phrases.length])

  return (
    <span key={i} className={cn("mf-think-in inline-block text-sm text-muted-foreground", className)}>
      {phrases[i]}
    </span>
  )
}
