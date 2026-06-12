import { cn } from "@/lib/utils"

/**
 * Reusable success checkmark that draws itself in (circle then check) with a
 * pop-in. Inherits color via `currentColor`, so tint it with a text color class.
 * Keyframes live in globals.css (homei-pop-in / homei-draw-circle / homei-draw-check).
 */
export function AnimatedCheck({
  size = 96,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Done"
      className={cn("text-emerald-500", className)}
      style={{
        transform: "scale(0)",
        animation:
          "homei-pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1.3) forwards",
      }}
    >
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        style={{
          strokeDasharray: 252,
          strokeDashoffset: 252,
          animation:
            "homei-draw-circle 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s forwards",
        }}
      />
      <polyline
        points="35 50 45 60 65 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: 50,
          strokeDashoffset: 50,
          animation:
            "homei-draw-check 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.6s forwards",
        }}
      />
    </svg>
  )
}
