/**
 * Tiny inline trend line for table rows — pure SVG, no chart library, so it's
 * cheap to render many at once. Stroke color reflects the trend direction
 * (second half vs first half): up = green, down = red, flat/empty = muted.
 */
export function Sparkline({
  data,
  width = 80,
  height = 26,
}: {
  data: number[]
  width?: number
  height?: number
}) {
  const total = data.reduce((s, v) => s + v, 0)
  const max = Math.max(1, ...data)
  const n = data.length

  const color =
    total === 0
      ? "var(--muted-foreground)"
      : trendUp(data)
        ? "var(--success)"
        : "var(--destructive)"

  const pad = 2
  const points = data.map((v, i) => {
    const x = n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2)
    const y = pad + (1 - v / max) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="overflow-visible"
      aria-hidden
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={total === 0 ? 0.5 : 1}
      />
    </svg>
  )
}

function trendUp(data: number[]): boolean {
  const half = Math.floor(data.length / 2)
  const first = data.slice(0, half).reduce((s, v) => s + v, 0)
  const second = data.slice(half).reduce((s, v) => s + v, 0)
  return second >= first
}
