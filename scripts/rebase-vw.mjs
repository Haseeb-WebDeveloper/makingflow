#!/usr/bin/env node
/**
 * rebase-vw.mjs — rebase every `vw` value from the 1333px reference to 1440px.
 *
 * Why 0.925926: existing vw values were generated as `px * 0.075` (1333 base).
 * To make them render their original px at 1440 instead:
 *   newVw = (oldVw / 0.075) * (100 / 1440) = oldVw * 0.925926
 *
 * Usage:
 *   node rebase-vw.mjs                  # dry run over src — prints stats, writes nothing
 *   node rebase-vw.mjs --apply          # writes changes to disk
 *   node rebase-vw.mjs --apply a.tsx b.tsx  # only rebase the given files
 *
 * Passing explicit files limits the run to just those — handy when resolving a
 * merge: take the other branch's version of a conflicted file, then rebase only
 * it, without re-walking (and double-rebasing) the rest of the tree.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, resolve } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const FACTOR = 100 / 1440 / 0.075; // 0.925925...
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".css"]);
const APPLY = process.argv.includes("--apply");
const FILE_ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

// Match an optional leading sign attached to the number, the number, then `vw`.
// Examples it catches: 0.075vw, 1.2vw, 96vw, .5vw, -0.6vw
const RE = /(-?)(\d*\.?\d+)vw\b/g;

function fmt(n) {
  // round to 3 decimals, trim trailing zeros
  let s = n.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === ".git") continue;
      walk(p, out);
    } else if (EXTS.has(extname(name))) {
      out.push(p);
    }
  }
  return out;
}

const files = FILE_ARGS.length ? FILE_ARGS.map((a) => resolve(ROOT, a)) : walk(SRC);
let totalReplacements = 0;
let filesTouched = 0;
const samples = [];
const valueCounts = new Map(); // oldVal -> {newVal, count}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  let count = 0;
  // Process line-by-line so we can skip whole lines that carry viewport-fraction
  // vw values (these must NOT be rebased — they mean "fraction of the viewport",
  // not a fixed px size that was converted):
  //   - `sizes="..."` image attributes (responsive load hints)        -> skip line
  //   - exactly `100vw` (full viewport, e.g. inside calc(100vw - ...)) -> skip token
  const next = src
    .split("\n")
    .map((line) => {
      if (/\bsizes=/.test(line)) return line; // image sizes attr = viewport fractions
      return line.replace(RE, (_m, sign, num) => {
        if (parseFloat(num) === 100) return `${sign}${num}vw`; // 100vw = full viewport
        const oldN = parseFloat(num);
        const newN = oldN * FACTOR;
        const out = `${sign}${fmt(newN)}vw`;
        count++;
        const key = `${sign}${num}vw`;
        const rec = valueCounts.get(key) || { newVal: out, count: 0 };
        rec.count++;
        valueCounts.set(key, rec);
        return out;
      });
    })
    .join("\n");
  if (count > 0) {
    totalReplacements += count;
    filesTouched++;
    if (samples.length < 12) {
      // capture first changed line for a sample diff
      const oldLines = src.split("\n");
      const newLines = next.split("\n");
      for (let i = 0; i < oldLines.length; i++) {
        if (oldLines[i] !== newLines[i]) {
          samples.push({
            file: relative(ROOT, file),
            line: i + 1,
            before: oldLines[i].trim(),
            after: newLines[i].trim(),
          });
          break;
        }
      }
    }
    if (APPLY) writeFileSync(file, next, "utf8");
  }
}

console.log(`\nvw rebase 1333 -> 1440   factor = ${FACTOR.toFixed(6)}`);
console.log(`mode: ${APPLY ? "APPLY (writing files)" : "DRY RUN (no writes)"}\n`);
console.log(`files scanned:      ${files.length}`);
console.log(`files with vw:      ${filesTouched}`);
console.log(`total replacements: ${totalReplacements}\n`);

console.log("most common value conversions:");
const top = [...valueCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 18);
for (const [oldVal, rec] of top) {
  console.log(`  ${oldVal.padEnd(12)} -> ${rec.newVal.padEnd(12)} (${rec.count}x)`);
}

console.log("\nsample line diffs:");
for (const s of samples) {
  console.log(`\n  ${s.file}:${s.line}`);
  console.log(`  -  ${s.before}`);
  console.log(`  +  ${s.after}`);
}

console.log(
  APPLY
    ? "\nDone. Files written.\n"
    : "\nDry run complete. Re-run with --apply to write changes.\n"
);
