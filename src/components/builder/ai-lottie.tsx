"use client"

import { DotLottieReact } from "@lottiefiles/dotlottie-react"
import { cn } from "@/lib/utils"

/** AI lottie from /public/lottie/ai.json, rendered with the dotLottie player. */
export function AiLottie({ className }: { className?: string }) {
  return (
    <DotLottieReact
      src="/lottie/ai.json"
      autoplay
      loop
      className={cn("pointer-events-none", className)}
    />
  )
}
