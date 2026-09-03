import { orbSpec } from "@/lib/avatar/orb"
import { cn } from "@/lib/utils"

/**
 * The generated tile itself — a colored ground with a pattern over it, and
 * optional initials on top.
 *
 * The ground is a CSS gradient on the wrapper rather than an SVG
 * `<linearGradient>`: a gradient element needs an id, ids must be unique on the
 * page, and several of these render side by side in the workspace switcher.
 * CSS sidesteps that entirely, and the wrapper's `overflow-hidden` does the
 * clipping the marks are drawn oversized to need.
 *
 * Size and corner radius come from `className` — the tile is square, and
 * `rounded-full` is what makes it read as a circle. No interactivity, so this
 * stays a Server Component wherever it's rendered from one.
 */
export function OrbAvatar({
  seed,
  label,
  className,
}: {
  /** A stable id. Never a display name — those change and collide. */
  seed: string
  /** Initials to lay over the tile. Omit for the pattern alone. */
  label?: string
  className?: string
}) {
  const spec = orbSpec(seed)

  return (
    <span
      aria-hidden="true"
      style={{ background: spec.background }}
      className={cn("relative block shrink-0 overflow-hidden", className)}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <g fill={spec.ink} stroke={spec.ink}>
          {spec.groups.map((group, gi) => (
            <g
              key={gi}
              transform={group.rotate ? `rotate(${group.rotate} 50 50)` : undefined}
            >
              {group.marks.map((mark, mi) =>
                mark.kind === "circle" ? (
                  <circle key={mi} cx={mark.cx} cy={mark.cy} r={mark.r} />
                ) : (
                  <path
                    key={mi}
                    d={mark.d}
                    fill={mark.stroke ? "none" : undefined}
                    strokeWidth={mark.stroke}
                  />
                ),
              )}
            </g>
          ))}
        </g>

        {label ? (
          <text
            x="50"
            y="50"
            dy=".345em"
            textAnchor="middle"
            fill={spec.letterFill}
            fontSize={label.length > 1 ? 37 : 49}
            fontWeight={600}
            letterSpacing={label.length > 1 ? 1 : 0}
          >
            {label}
          </text>
        ) : null}
      </svg>
    </span>
  )
}
