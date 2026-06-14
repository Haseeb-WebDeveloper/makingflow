"use client"

import { DotLottieReact } from "@lottiefiles/dotlottie-react"
import { cn } from "@/lib/utils"

/** Lottie from /public/lottie/{name}.json, rendered with the dotLottie player. */
export function Lottie({ className, name }: { className?: string; name: string }) {
  return (
    <DotLottieReact
      src={`/lottie/${name}.json`}
      autoplay
      loop
      className={cn("pointer-events-none", className)}
    />
  )
}
