#!/usr/bin/env node
/**
 * px-to-vw.mjs — add `lg:` vw variants to Tailwind utilities, per
 * px-to-vw-for-lg-or-bigger-devices.txt. Base viewport 1333px (1px = 0.075vw).
 * Run scripts/rebase-vw.mjs afterwards to rebase 1333 -> 1440.
 *
 * Two transforms, decided per class line so it stays idempotent:
 *   1. Existing `lg:<util>-[<N>px|rem]`  ->  `lg:<util>-[<vw>vw]`.
 *   2. A base utility with NO `lg:` sibling on that line  ->  append `lg:<util>-[<vw>vw]`.
 *
 * Skips everything the guide says to skip (borders, shadows, rings, full/screen,
 * fractions, unitless utils, colors, already-vw/%/rem-intentional, etc.).
 *
 * Usage:
 *   node scripts/px-to-vw.mjs                 # dry run over src (no writes)
 *   node scripts/px-to-vw.mjs --apply         # write changes
 *   node scripts/px-to-vw.mjs --apply a.tsx   # only the given files
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, extname, relative, resolve } from "node:path"

const ROOT = process.cwd()
const SRC = join(ROOT, "src")
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js"])
const APPLY = process.argv.includes("--apply")
const FILE_ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"))

const PX_TO_VW = 0.075 // 1px at 1333px base
const REM_TO_VW = 1.2 // 1rem = 16px = 1.2vw
const STEP_TO_VW = 0.3 // one Tailwind spacing step (4px) = 0.3vw

// Font-size scale (named -> vw at 1333 base), from the guide's lookup table.
const FONT = {
  xs: 0.9, sm: 1.05, base: 1.2, lg: 1.35, xl: 1.5,
  "2xl": 1.8, "3xl": 2.25, "4xl": 2.7, "5xl": 3.6,
  "6xl": 4.5, "7xl": 5.4, "8xl": 7.2, "9xl": 9.6,
}
// Rounded scale (eyeballed in the guide). `none`/`full` are left alone.
const ROUNDED = { sm: 0.5, md: 0.6, lg: 0.75, xl: 1, "2xl": 1.2, "3xl": 1.7, "4xl": 1.7 }

// Utilities that take a length and should be converted. Longest first so the
// alternation never matches `p` before `px`.
const LEN_UTILS = [
  "min-w", "max-w", "min-h", "max-h", "size",
  "space-x", "space-y", "gap-x", "gap-y", "gap",
  "inset-x", "inset-y", "inset",
  "translate-x", "translate-y",
  "scroll-mx", "scroll-my", "scroll-px", "scroll-py",
  "px", "py", "pt", "pr", "pb", "pl", "p",
  "mx", "my", "mt", "mr", "mb", "ml", "m",
  "top", "right", "bottom", "left",
  "w", "h",
].sort((a, b) => b.length - a.length)
const LEN_RE = LEN_UTILS.join("|")

const ROUND_SIDES = "(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?"
const BD = `(?<=^|[\\s"'\`({])` // left boundary (start or class delimiter)
const AD = `(?=[\\s"'\`)}]|$)` // right boundary

function fmt(n) {
  let s = n.toFixed(3)
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "")
  return s === "" || s === "-0" ? "0" : s
}
const lenToVw = (n, unit) => (unit === "rem" ? n * REM_TO_VW : n * PX_TO_VW)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === ".git") continue
      walk(p, out)
    } else if (EXTS.has(extname(name))) out.push(p)
  }
  return out
}

const stats = { px: 0, named: 0, added: 0 }
const valueCounts = new Map()
const bump = (k, v) => valueCounts.set(k, (valueCounts.get(k) || 0) + 1) && v

/**
 * Process one line. `lgUtils` is seeded with the lg-prefixed utilities already
 * present on the line so we never add a second lg: variant for the same util.
 */
function processLine(line) {
  // Skip image responsive hints (those vw are viewport fractions, not sizes).
  if (/\bsizes=/.test(line)) return line

  // 1) Convert existing lg:<util>-[Npx|rem] -> vw. Captures an optional negative
  //    sign that sits between `lg:` and the utility (e.g. lg:-mx-[14px]).
  line = line.replace(
    /\blg:(-?)([a-z][a-z0-9-]*?)-\[(-?\d*\.?\d+)(px|rem)\]/g,
    (m, sign, util, num, unit) => {
      const vw = fmt(lenToVw(parseFloat(num), unit))
      stats.px++
      return bump(`lg:${sign}${util}-[${num}${unit}]`, `lg:${sign}${util}-[${vw}vw]`)
    },
  )

  // Which utilities already have a lg: variant on this line (after step 1).
  const lgHas = new Set()
  for (const mm of line.matchAll(/\blg:(-?[a-z][a-z0-9-]*?)-\[/g)) lgHas.add(mm[1])

  const append = (util, vw, sign = "") => ` lg:${sign}${util}-[${fmt(vw)}vw]`

  // 2a) Length utilities — numeric spacing steps. Skips 0, fractions, keywords.
  line = line.replace(
    new RegExp(`${BD}(-?)(${LEN_RE})-(\\d+(?:\\.\\d+)?)${AD}`, "g"),
    (m, sign, util, num) => {
      const n = parseFloat(num)
      if (n === 0) return m
      if (lgHas.has(`${sign}${util}`)) return m
      lgHas.add(`${sign}${util}`)
      stats.added++
      return m + append(util, n * STEP_TO_VW, sign)
    },
  )

  // 2b) Length utilities — arbitrary px/rem (e.g. w-[20px], -mt-[1.5rem]).
  line = line.replace(
    new RegExp(`${BD}(-?)(${LEN_RE})-\\[(-?\\d*\\.?\\d+)(px|rem)\\]${AD}`, "g"),
    (m, sign, util, num, unit) => {
      if (lgHas.has(`${sign}${util}`)) return m
      lgHas.add(`${sign}${util}`)
      stats.added++
      return m + append(util, lenToVw(parseFloat(num), unit), sign)
    },
  )

  // 2c) Fixed line-heights leading-3 .. leading-10.
  line = line.replace(new RegExp(`${BD}leading-(3|4|5|6|7|8|9|10)${AD}`, "g"), (m, n) => {
    if (lgHas.has("leading")) return m
    lgHas.add("leading")
    stats.added++
    return m + append("leading", parseInt(n, 10) * STEP_TO_VW)
  })

  // 2d) Font sizes — named scale.
  const fontNames = Object.keys(FONT).join("|")
  line = line.replace(new RegExp(`${BD}text-(${fontNames})${AD}`, "g"), (m, name) => {
    if (lgHas.has("text")) return m
    lgHas.add("text")
    stats.named++
    return m + ` lg:text-[${fmt(FONT[name])}vw]`
  })

  // 2e) Font sizes — arbitrary px/rem (text-[18px], text-[1.1rem]). Color/other
  //     arbitrary values (text-[#fff], text-[var(--x)]) never match this.
  line = line.replace(new RegExp(`${BD}text-\\[(\\d*\\.?\\d+)(px|rem)\\]${AD}`, "g"), (m, num, unit) => {
    if (lgHas.has("text")) return m
    lgHas.add("text")
    stats.named++
    return m + ` lg:text-[${fmt(lenToVw(parseFloat(num), unit))}vw]`
  })

  // 2f) Rounded — named (with optional side). `rounded-full`/`rounded-none` left as-is.
  line = line.replace(
    new RegExp(`${BD}rounded(${ROUND_SIDES})-(sm|md|lg|xl|2xl|3xl|4xl)${AD}`, "g"),
    (m, side, size) => {
      const key = `rounded${side}`
      if (lgHas.has(key)) return m
      lgHas.add(key)
      stats.named++
      return m + ` lg:rounded${side}-[${fmt(ROUNDED[size])}vw]`
    },
  )
  // Bare `rounded` (default radius = 0.35vw), only when not part of a longer token.
  line = line.replace(new RegExp(`${BD}rounded${AD}`, "g"), (m) => {
    if (lgHas.has("rounded")) return m
    lgHas.add("rounded")
    stats.named++
    return m + ` lg:rounded-[0.35vw]`
  })
  // Rounded — arbitrary px/rem (with optional side).
  line = line.replace(
    new RegExp(`${BD}rounded(${ROUND_SIDES})-\\[(\\d*\\.?\\d+)(px|rem)\\]${AD}`, "g"),
    (m, side, num, unit) => {
      const key = `rounded${side}`
      if (lgHas.has(key)) return m
      lgHas.add(key)
      stats.named++
      return m + ` lg:rounded${side}-[${fmt(lenToVw(parseFloat(num), unit))}vw]`
    },
  )

  return line
}

const files = FILE_ARGS.length ? FILE_ARGS.map((a) => resolve(ROOT, a)) : walk(SRC)
let filesTouched = 0
const samples = []

for (const file of files) {
  const src = readFileSync(file, "utf8")
  const out = src.split("\n").map(processLine).join("\n")
  if (out !== src) {
    filesTouched++
    if (APPLY) writeFileSync(file, out, "utf8")
    if (samples.length < 16) {
      const a = src.split("\n")
      const b = out.split("\n")
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          samples.push({ file: relative(ROOT, file), line: i + 1, before: a[i].trim(), after: b[i].trim() })
          break
        }
      }
    }
  }
}

console.log(`\npx -> vw (1333 base)   mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`)
console.log(`files scanned:   ${files.length}`)
console.log(`files changed:   ${filesTouched}`)
console.log(`lg:[px] -> vw:   ${stats.px}`)
console.log(`base lengths +lg: ${stats.added}`)
console.log(`font/rounded +lg: ${stats.named}\n`)

console.log("most common conversions:")
for (const [k, v] of [...valueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${String(v).padEnd(10)} ${k}`)
}
console.log("\nsample diffs:")
for (const s of samples) {
  console.log(`\n  ${s.file}:${s.line}`)
  console.log(`  -  ${s.before}`)
  console.log(`  +  ${s.after}`)
}
console.log(APPLY ? "\nDone. Now run: node scripts/rebase-vw.mjs --apply\n" : "\nDry run. Re-run with --apply to write.\n")
