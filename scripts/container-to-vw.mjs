#!/usr/bin/env node
/**
 * container-to-vw.mjs — add `lg:` vw variants for the named container scale on
 * `max-w-*` / `min-w-*` (xs..7xl), which the spacing-based px-to-vw pass skips.
 * Emits FINAL 1440-base vw directly (so it does NOT need rebase-vw.mjs).
 *
 * Like everything else: base class kept for < lg, vw added for lg+. So on the
 * 1440 design width a `max-w-6xl` (1152px) stays 1152px, and scales with the
 * viewport above/below that. Idempotent (skips lines that already have lg:max-w-).
 *
 * Usage: node scripts/container-to-vw.mjs [--apply] [files...]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, extname, relative, resolve } from "node:path"

const ROOT = process.cwd()
const SRC = join(ROOT, "src")
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js"])
const APPLY = process.argv.includes("--apply")
const FILE_ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"))

// Tailwind container scale in px, converted to vw at the 1440 base (px/1440*100).
const PX = {
  xs: 320, sm: 384, md: 448, lg: 512, xl: 576,
  "2xl": 672, "3xl": 768, "4xl": 896, "5xl": 1024, "6xl": 1152, "7xl": 1280,
}
const fmt = (n) => {
  let s = n.toFixed(3)
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s
}
const VW = Object.fromEntries(Object.entries(PX).map(([k, px]) => [k, fmt((px / 1440) * 100)]))
const NAMES = Object.keys(PX).join("|")

const BD = `(?<=^|[\\s"'\`({])`
const AD = `(?=[\\s"'\`)}]|$)`
const RE = new RegExp(`${BD}(max-w|min-w)-(${NAMES})${AD}`, "g")

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

function processLine(line) {
  if (/\bsizes=/.test(line)) return line
  const lgHas = new Set()
  for (const m of line.matchAll(/\blg:(max-w|min-w)-\[/g)) lgHas.add(m[1])
  return line.replace(RE, (m, util, size) => {
    if (lgHas.has(util)) return m
    lgHas.add(util)
    stats++
    return `${m} lg:${util}-[${VW[size]}vw]`
  })
}

let stats = 0
const files = FILE_ARGS.length ? FILE_ARGS.map((a) => resolve(ROOT, a)) : walk(SRC)
let touched = 0
const samples = []

for (const file of files) {
  const src = readFileSync(file, "utf8")
  const out = src.split("\n").map(processLine).join("\n")
  if (out !== src) {
    touched++
    if (APPLY) writeFileSync(file, out, "utf8")
    if (samples.length < 12) {
      const a = src.split("\n")
      const b = out.split("\n")
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          samples.push({ file: relative(ROOT, file), before: a[i].trim(), after: b[i].trim() })
          break
        }
      }
    }
  }
}

console.log(`\nmax-w/min-w container -> vw (1440 base)   mode: ${APPLY ? "APPLY" : "DRY RUN"}`)
console.log(`scale: ${Object.entries(VW).map(([k, v]) => `${k}=${v}vw`).join("  ")}`)
console.log(`files changed: ${touched}   utilities converted: ${stats}\n`)
for (const s of samples) {
  console.log(`  ${s.file}`)
  console.log(`  -  ${s.before}`)
  console.log(`  +  ${s.after}\n`)
}
console.log(APPLY ? "Done.\n" : "Dry run. Re-run with --apply to write.\n")
