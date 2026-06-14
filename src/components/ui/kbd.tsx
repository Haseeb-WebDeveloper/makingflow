import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 lg:h-[20px] w-fit min-w-5 lg:min-w-[20px] items-center justify-center gap-1 lg:gap-[4px] rounded-sm lg:rounded-[7px] bg-muted px-1 lg:px-[4px] font-sans text-xs lg:text-[12px] font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
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
      className={cn("inline-flex items-center gap-1 lg:gap-[4px]", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
