import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-xl lg:rounded-[0.926vw] bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
