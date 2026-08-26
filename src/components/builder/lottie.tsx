"use client"

import { DotLottieReact } from "@lottiefiles/dotlottie-react"
import type { DotLottie } from "@lottiefiles/dotlottie-react"
import { cn } from "@/lib/utils"

/** Lottie from /public/lottie/{name}.json, rendered with the dotLottie player. */
export function Lottie({
  className,
  name,
  loop = true,
  segment,
}: {
  className?: string
  name: string
  /** Decorative loops (the AI orb, the empty states) want true; a one-shot
   *  confirmation wants false, so it plays through and holds its last frame. */
  loop?: boolean
  /** Play only [start, end] instead of the whole file. Needed when an animation
   *  ends by animating itself back out and the caller wants it to stay put. */
  segment?: [number, number]
}) {
  const endFrame = segment?.[1]

  return (
    <DotLottieReact
      src={`/lottie/${name}.json`}
      autoplay
      loop={loop}
      segment={segment}
      dotLottieRefCallback={(dl: DotLottie | null) => {
        if (!dl || endFrame === undefined) return
        // Belt and braces for a one-shot: pin the last frame on complete so a
        // player that rewinds on stop can't flash the empty first frame.
        dl.addEventListener("complete", () => {
          dl.setFrame(endFrame)
          dl.pause()
        })
      }}
      className={cn("pointer-events-none", className)}
    />
  )
}
