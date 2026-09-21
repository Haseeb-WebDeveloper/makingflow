"use client"

import { SuccessContent } from "@/components/forms/success-content"
import { SuccessMark } from "@/components/forms/success-mark"
import { cn } from "@/lib/utils"

/**
 * The post-submit screen respondents land on: the animated check, the thank-you
 * title, then the owner-authored body/video. Shared by the public runtime and
 * the builder's "After submit" preview so both render byte-for-byte the same.
 */
export function SuccessScreen({
  title,
  body,
  videoUrl,
  className,
}: {
  title: string
  body?: string | null
  videoUrl?: string | null
  className?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-[70dvh] w-full max-w-xl flex-col items-center justify-center text-center",
        className
      )}
    >
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
        <SuccessMark className="size-52" />
      </div>
      <h2 className="w-full mt-4 text-2xl font-bold tracking-tight text-foreground">{title}</h2>
      <SuccessContent body={body} videoUrl={videoUrl} className="mt-6 w-full" />
    </div>
  )
}
