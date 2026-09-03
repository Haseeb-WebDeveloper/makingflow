/**
 * Generative avatars for workspaces without an uploaded logo.
 *
 * A single letter on a flat square makes every logo-less workspace look like
 * every other one — in the switcher they're indistinguishable at a glance.
 * This derives a colorful tile from the workspace id instead: same id, same
 * tile, forever, with no storage, no network and no extra column.
 *
 * Seeded off the **id**, never the name — renaming a workspace must not change
 * its avatar, and two workspaces called "Marketing" must not collide.
 *
 * Everything here is a pure function of the seed with no `Math.random` and no
 * clock, so a Server Component and the client bundle render byte-identical
 * markup. Break that and you get a hydration mismatch.
 *
 * The renderer is `OrbAvatar` in `@/components/ui/orb-avatar`; this module
 * knows nothing about React and is unit-tested on its own.
 */

export type Hsl = { h: number; s: number; l: number }

export type OrbMark =
  | { kind: "path"; d: string; stroke?: number }
  | { kind: "circle"; cx: number; cy: number; r: number }

/** Marks that share one rotation about the tile's centre. */
export type OrbGroup = { rotate: number; marks: OrbMark[] }

export type OrbSpec = {
  /** Ready-to-use CSS value for the ground, painted by the wrapper element. */
  background: string
  /** Flat color for every mark. One tone, so overlaps never read as blotches. */
  ink: string
  groups: OrbGroup[]
  /** Text color for initials laid over the tile, picked for contrast. */
  letterFill: string
}

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** FNV-1a. Not cryptographic — it only has to spread ids across the palette. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and good enough to look unpatterned. */
function rng(seedInt: number): () => number {
  let a = seedInt >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const n2 = (v: number) => Number(v.toFixed(1))

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/**
 * A uniform 0-360 hue pick spends a third of its range on khaki, olive and
 * mustard, which look like a rendering bug next to the rest. These are the
 * bands that stay jewel-bright at any lightness; 46-125 is skipped on purpose.
 */
const HUE_BANDS: readonly (readonly [number, number, number])[] = [
  [188, 232, 3], // azure -> cobalt
  [246, 288, 3], // indigo -> violet
  [158, 186, 2], // teal -> mint
  [292, 330, 2], // orchid -> magenta
  [334, 356, 2], // rose
  [126, 154, 1.5], // emerald
  [24, 44, 1.5], // amber -> gold
  [2, 18, 1.2], // coral
]

function pickHue(rand: () => number): number {
  let t = rand() * HUE_BANDS.reduce((sum, b) => sum + b[2], 0)
  for (const [lo, hi, weight] of HUE_BANDS) {
    if ((t -= weight) <= 0) return Math.round(lo + rand() * (hi - lo))
  }
  return Math.round(HUE_BANDS[0][0] + rand() * 44)
}

/** Pull an arbitrary hue (a complement, say) into the nearest good band. */
function snapHue(h: number): number {
  h = ((h % 360) + 360) % 360
  let best = h
  let bestGap = Infinity
  for (const [lo, hi] of HUE_BANDS) {
    if (h >= lo && h <= hi) return h
    for (const edge of [lo, hi]) {
      const gap = Math.min(Math.abs(h - edge), 360 - Math.abs(h - edge))
      if (gap < bestGap) {
        bestGap = gap
        best = edge
      }
    }
  }
  return best
}

/**
 * A neighbouring hue for the second gradient stop, kept inside the same band —
 * `hue + 30` off gold lands in olive, which is what the bands exist to avoid.
 */
function nearHue(h: number, delta: number): number {
  const band = HUE_BANDS.find(([lo, hi]) => h >= lo && h <= hi)
  if (!band) return snapHue(h + delta)
  const [lo, hi] = band
  return Math.round(h + delta <= hi ? h + delta : Math.max(lo, h - delta))
}

const css = (c: Hsl) => `hsl(${c.h} ${c.s}% ${c.l}%)`

export const ORB_MOODS = ["luminous", "sorbet", "glass", "midnight", "duotone"] as const
export type OrbMood = (typeof ORB_MOODS)[number]

/**
 * Each mood returns a two-stop ground and one mark tone. Both random draws
 * happen up front so every branch consumes the stream identically — otherwise
 * changing the mood would also reshuffle the pattern.
 */
function moodColors(mood: OrbMood, hue: number, rand: () => number) {
  const near = nearHue(hue, 14 + rand() * 20)
  const far = snapHue(hue + 150 + rand() * 70)
  switch (mood) {
    case "sorbet": // bright analogous sweep, near-white marks
      return { base: [{ h: hue, s: 90, l: 66 }, { h: near, s: 92, l: 73 }] as const,
               ink: { h: near, s: 96, l: 88 } }
    case "glass": // airy and pale, mid-tone marks
      return { base: [{ h: hue, s: 80, l: 88 }, { h: near, s: 74, l: 80 }] as const,
               ink: { h: hue, s: 60, l: 61 } }
    case "midnight": // deep ground, one electric accent
      return { base: [{ h: hue, s: 56, l: 24 }, { h: near, s: 60, l: 33 }] as const,
               ink: { h: near, s: 94, l: 65 } }
    case "duotone": // two hues from opposite sides of the wheel
      return { base: [{ h: hue, s: 82, l: 58 }, { h: hue, s: 82, l: 58 }] as const,
               ink: { h: far, s: 90, l: 72 } }
    default: // luminous — saturated, with depth in the ground
      return { base: [{ h: hue, s: 88, l: 57 }, { h: near, s: 90, l: 66 }] as const,
               ink: { h: near, s: 92, l: 81 } }
  }
}

/** WCAG relative luminance, straight from an HSL triple. */
export function hslLuma(c: Hsl): number {
  const s = c.s / 100
  const l = c.l / 100
  const a = s * Math.min(l, 1 - l)
  const k = (n: number) => (n + c.h / 30) % 12
  const chan = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(chan(0)) + 0.7152 * lin(chan(8)) + 0.0722 * lin(chan(4))
}

/** WCAG contrast ratio between two HSL colors. */
export function contrastRatio(a: Hsl, b: Hsl): number {
  const [hi, lo] = [hslLuma(a), hslLuma(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Hue moves luminance as much as lightness does, so two colors twenty points
 * apart in L can still render at the same brightness — a pattern that vanishes
 * entirely. Slide the mark to the nearest lightness that separates it from the
 * ground by a visible but unharsh ratio.
 */
function ensureContrast(
  ground: Hsl,
  mark: Hsl,
  min: number,
  max: number,
  /** Extra condition the winning tone must also satisfy, if one is given. */
  accept?: (candidate: Hsl) => boolean,
): Hsl {
  let best = mark
  let bestGap = Infinity
  // Kept separately so an unsatisfiable `accept` degrades to a merely
  // in-range tone instead of returning the untouched original.
  let inRange = mark
  let inRangeGap = Infinity

  for (let l = 4; l <= 97; l += 0.5) {
    const candidate = { h: mark.h, s: mark.s, l }
    const ratio = contrastRatio(ground, candidate)
    if (ratio < min || ratio > max) continue
    const gap = Math.abs(l - mark.l)
    if (gap < inRangeGap) {
      inRangeGap = gap
      inRange = candidate
    }
    if (accept && !accept(candidate)) continue
    if (gap < bestGap) {
      bestGap = gap
      best = candidate
    }
  }

  const winner = bestGap < Infinity ? best : inRange
  return { h: winner.h, s: winner.s, l: Math.round(winner.l * 10) / 10 }
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

export const ORB_PATTERNS = ["terminator", "bands"] as const
export type OrbPattern = (typeof ORB_PATTERNS)[number]

/** CSS gradient angles, in the order a seed may pick them. */
const GRADIENT_ANGLES = [135, 90, 180, 225]

/**
 * A wave swept wider than the tile, so any rotation still covers it. Marks are
 * deliberately oversized; the wrapper clips them.
 */
function wave(rand: () => number, mid: number, amp: number, step: number): string {
  let dir = rand() < 0.5 ? -1 : 1
  let d = `M-70 ${n2(mid)}`
  for (let x = -70; x < 170; x += step) {
    d +=
      ` C${n2(x + step * 0.35)} ${n2(mid + dir * amp)},` +
      `${n2(x + step * 0.65)} ${n2(mid - dir * amp)},` +
      `${n2(x + step)} ${n2(mid)}`
    dir *= -1
  }
  return d
}

/** Non-overlapping discs, biased toward the interior of the tile. */
function craterField(
  rand: () => number,
  count: number,
  minR: number,
  maxR: number,
  bound: number,
): OrbMark[] {
  const out: OrbMark[] = []
  for (let t = 0; t < 400 && out.length < count; t++) {
    const r = minR + rand() * (maxR - minR)
    const ang = rand() * Math.PI * 2
    const dist = Math.sqrt(rand()) * Math.max(0, bound - r)
    const cx = 50 + Math.cos(ang) * dist
    const cy = 50 + Math.sin(ang) * dist
    if (out.some((c) => c.kind === "circle" && Math.hypot(c.cx - cx, c.cy - cy) < c.r + r + 2.5)) {
      continue
    }
    out.push({ kind: "circle", cx: n2(cx), cy: n2(cy), r: n2(r) })
  }
  return out
}

function patternGroups(kind: OrbPattern, rand: () => number): OrbGroup[] {
  const pick = (lo: number, hi: number) => lo + rand() * (hi - lo)

  if (kind === "bands") {
    const rotate = n2(rand() * 360)
    const count = 2 + Math.floor(rand() * 3)
    const amp = pick(6, 16)
    const step = pick(50, 80)
    const width = pick(8, 17)
    const gap = pick(24, 34)
    const marks: OrbMark[] = []
    for (let i = 0; i < count; i++) {
      marks.push({ kind: "path", d: wave(rand, 22 + i * gap, amp, step), stroke: n2(width) })
    }
    return [{ rotate, marks }]
  }

  // terminator — a flowing light/dark divide, plus craters
  const d = `${wave(rand, 30 + rand() * 26, 11 + rand() * 16, 46 + rand() * 20)} L170 -70 L-70 -70Z`
  const rotate = n2(rand() * 360)
  return [
    { rotate, marks: [{ kind: "path", d }] },
    { rotate: 0, marks: craterField(rand, 3 + Math.floor(rand() * 3), 4.5, 13.5, 41) },
  ]
}

// ---------------------------------------------------------------------------

/**
 * Everything needed to draw one tile. Pass a stable id, not a display name.
 *
 * `pattern` and `mood` exist for previews and tests; production calls pass the
 * seed alone and let the hash decide.
 */
export function orbSpec(
  seed: string,
  options: { pattern?: OrbPattern; mood?: OrbMood } = {},
): OrbSpec {
  const rand = rng(hashSeed(seed))
  const one = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]

  // Draw both traits before applying any override: `??` would short-circuit
  // the call, leaving that value in the stream and shifting everything drawn
  // after it. Pinning a mood must not also change the pattern.
  const drawnPattern = one(ORB_PATTERNS)
  const drawnMood = one(ORB_MOODS)
  const pattern = options.pattern ?? drawnPattern
  const mood = options.mood ?? drawnMood
  const hue = pickHue(rand)

  const { base, ink: raw } = moodColors(mood, hue, rand)
  const angle = GRADIENT_ANGLES[Math.floor(rand() * GRADIENT_ANGLES.length)]

  // Score the marks against the middle of the gradient, not one stop of it.
  const ground: Hsl = {
    h: base[0].h,
    s: (base[0].s + base[1].s) / 2,
    l: (base[0].l + base[1].l) / 2,
  }
  // A letter crosses both the ground and the marks, so score candidates on
  // their *worst* case rather than on an average — an average happily picks a
  // tone that disappears wherever the glyph passes over a mark.
  const white: Hsl = { h: ground.h, s: 0, l: 100 }
  const deep: Hsl = { h: ground.h, s: 58, l: 14 }
  const legibility = (letter: Hsl, over: Hsl) =>
    Math.min(contrastRatio(ground, letter), contrastRatio(over, letter))

  // Picking the marks and then the letter independently doesn't work: a
  // gold-tinted midnight ground pushes its mark bright enough that white
  // letters fail on the mark and dark ones fail on the ground, leaving no
  // legible choice. So the mark tone is required up front to leave room for
  // one — the search takes the tone nearest the designed value that does.
  const ink = ensureContrast(ground, raw, 1.45, 3.2, (candidate) =>
    Math.max(legibility(white, candidate), legibility(deep, candidate)) >= 3,
  )

  return {
    background: `linear-gradient(${angle}deg, ${css(base[0])}, ${css(base[1])})`,
    ink: css(ink),
    groups: patternGroups(pattern, rand),
    letterFill: legibility(white, ink) >= legibility(deep, ink) ? "#ffffff" : css(deep),
  }
}

/**
 * Initials for a workspace name: "Acme Studio" -> AS, "makingflow" -> MA.
 * Returns "" when there's nothing alphanumeric to show, so the caller can draw
 * the tile bare instead of a stray space.
 */
export function orbInitials(name: string, count: 1 | 2 = 1): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (parts.length === 0) return ""
  const raw = count > 1 && parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0]
  return raw.toUpperCase().slice(0, count)
}
