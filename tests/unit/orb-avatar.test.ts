/**
 * The generated workspace avatar.
 *
 * Three things here are easy to break and hard to see: the tile must be a pure
 * function of the seed (a Server Component and the client bundle both render
 * it, so any drift is a hydration mismatch), the marks must actually contrast
 * with the ground (hue moves luminance as much as lightness does, so two
 * colors far apart in L can still come out the same brightness and the pattern
 * disappears), and the seed must be the workspace id rather than its name —
 * otherwise a rename silently changes the avatar.
 */
import { describe, expect, test } from "vitest"
import {
  ORB_MOODS,
  ORB_PATTERNS,
  contrastRatio,
  hashSeed,
  orbInitials,
  orbSpec,
  type Hsl,
} from "@/lib/avatar/orb"

/** Realistic seeds: uuids, as `workspaces.id` hands them over. */
const IDS = Array.from(
  { length: 200 },
  (_, i) => `3f8b${String(i).padStart(4, "0")}-1c2d-4e5f-8a9b-0c1d2e3f4a5b`,
)

function parseHsl(value: string): Hsl {
  const m = value.match(/hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)/)
  if (!m) throw new Error(`not an hsl() string: ${value}`)
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) }
}

/** Both stops of the ground, straight out of the CSS gradient. */
function groundStops(background: string): [Hsl, Hsl] {
  const stops = background.match(/hsl\([^)]+\)/g)
  expect(stops).toHaveLength(2)
  return [parseHsl(stops![0]), parseHsl(stops![1])]
}

describe("orbSpec", () => {
  test("is a pure function of the seed", () => {
    for (const id of IDS.slice(0, 20)) {
      expect(orbSpec(id)).toEqual(orbSpec(id))
    }
  })

  test("gives different workspaces different tiles", () => {
    const seen = new Set(IDS.map((id) => JSON.stringify(orbSpec(id))))
    // Collisions are possible in principle; a flood of them means the hash or
    // the palette collapsed.
    expect(seen.size).toBeGreaterThan(IDS.length * 0.95)
  })

  test("emits usable geometry — no NaN leaking into path data", () => {
    for (const id of IDS) {
      const spec = orbSpec(id)
      expect(spec.groups.length).toBeGreaterThan(0)
      const marks = spec.groups.flatMap((g) => g.marks)
      expect(marks.length).toBeGreaterThan(0)
      for (const mark of marks) {
        if (mark.kind === "path") {
          expect(mark.d).not.toMatch(/NaN|undefined|Infinity/)
          expect(mark.d.startsWith("M")).toBe(true)
        } else {
          expect(Number.isFinite(mark.cx + mark.cy + mark.r)).toBe(true)
          expect(mark.r).toBeGreaterThan(0)
        }
      }
    }
  })

  test("keeps every hue out of the khaki band", () => {
    // 46-125 is olive/mustard territory: it reads as a rendering fault next to
    // the rest of the palette, so the generator never picks from it.
    for (const id of IDS) {
      for (const stop of groundStops(orbSpec(id).background)) {
        expect(stop.h > 45 && stop.h < 126).toBe(false)
      }
    }
  })

  test("marks stay visible against the ground, in every mood", () => {
    for (const mood of ORB_MOODS) {
      for (const id of IDS.slice(0, 60)) {
        const spec = orbSpec(id, { mood })
        const [from, to] = groundStops(spec.background)
        const ground: Hsl = { h: from.h, s: (from.s + to.s) / 2, l: (from.l + to.l) / 2 }
        const ratio = contrastRatio(ground, parseHsl(spec.ink))
        // Visible, but not a harsh two-tone stripe.
        expect(ratio).toBeGreaterThanOrEqual(1.44)
        expect(ratio).toBeLessThanOrEqual(3.21)
      }
    }
  })

  test("initials stay legible over the ground *and* over the marks", () => {
    // The glyph crosses both, so checking it against the ground alone passes
    // tiles whose letter disappears wherever it overlaps a mark.
    for (const mood of ORB_MOODS) {
      for (const id of IDS) {
        const spec = orbSpec(id, { mood })
        const [from, to] = groundStops(spec.background)
        const ground: Hsl = { h: from.h, s: (from.s + to.s) / 2, l: (from.l + to.l) / 2 }
        const letter =
          spec.letterFill === "#ffffff" ? { h: ground.h, s: 0, l: 100 } : parseHsl(spec.letterFill)
        expect(contrastRatio(ground, letter)).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(parseHsl(spec.ink), letter)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test("pinning one trait doesn't reshuffle the other", () => {
    // The preview in settings pins a pattern; the color must not jump with it.
    const id = IDS[0]
    const base = orbSpec(id)
    for (const pattern of ORB_PATTERNS) {
      expect(orbSpec(id, { pattern }).background).toBe(base.background)
    }
    for (const mood of ORB_MOODS) {
      expect(orbSpec(id, { mood }).groups).toEqual(base.groups)
    }
  })
})

describe("orbInitials", () => {
  test("reads the workspace name the way a person would", () => {
    expect(orbInitials("Acme Studio")).toBe("A")
    expect(orbInitials("Acme Studio", 2)).toBe("AS")
    expect(orbInitials("makingflow", 2)).toBe("MA")
    expect(orbInitials("  spaced  out ", 2)).toBe("SO")
  })

  test("returns nothing rather than a stray space", () => {
    // A name can be emoji-only or whitespace; the tile then renders bare.
    expect(orbInitials("   ", 2)).toBe("")
    expect(orbInitials("🙂")).toBe("")
  })
})

describe("hashSeed", () => {
  test("stays inside uint32 for the ids we feed it", () => {
    for (const id of IDS) {
      const h = hashSeed(id)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})
