import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 lg:h-[1.389vw] w-fit min-w-5 lg:min-w-[1.389vw] items-center justify-center gap-1 lg:gap-[0.278vw] rounded-sm lg:rounded-[0.463vw] bg-muted px-1 lg:px-[0.278vw] font-sans text-xs lg:text-[0.833vw] font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1 lg:gap-[0.278vw]", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
