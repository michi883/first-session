#!/usr/bin/env node
// One-off migration: tidy an ALREADY-GENERATED parent-shareable TSV.
//
//   Reads:  data/therapists_parent_shareable.tsv
//   Writes: data/therapists_parent_shareable.cleaned.tsv
//
// It rewrites only two columns — "Noted Focus Areas" and "Therapist Style" — using
// the same deterministic rules as the permanent exporter (see pipeline/lib/parent-clean.js).
// Every other column, the row order, and the column count are preserved exactly.
//
// This script makes NO AI/API calls. It is pure string normalization: safe, fast,
// and repeatable. Run it whenever you have a generated TSV that predates the cleanup
// rules; future TSVs from `node pipeline/extract.js --spreadsheet-only` already apply
// them.
//
// Usage:
//   node pipeline/clean-parent-shareable-tsv.js

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanFocusList, cleanStyleList } from "./lib/parent-clean.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "..", "data");
const INPUT_FILE = path.join(OUTPUT_DIR, "therapists_parent_shareable.tsv");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "therapists_parent_shareable.cleaned.tsv");

const FOCUS_COLUMN = "Noted Focus Areas";
const STYLE_COLUMN = "Therapist Style";
const SEP = "; ";

/** Split a "; "-joined cell into trimmed items (empty cell -> []). */
function splitCell(cell) {
  if (!cell) return [];
  return cell
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`✗ Input not found: ${INPUT_FILE}`);
    console.error("  Generate it first: node pipeline/extract.js --spreadsheet-only");
    process.exitCode = 1;
    return;
  }

  const text = await readFile(INPUT_FILE, "utf8");
  // Preserve whether the file ended with a trailing newline so we round-trip it.
  const hadTrailingNewline = text.endsWith("\n");
  const lines = text.replace(/\n$/, "").split("\n");

  if (lines.length === 0 || lines[0].trim() === "") {
    console.error("✗ Input TSV appears to be empty.");
    process.exitCode = 1;
    return;
  }

  const header = lines[0].split("\t");
  const expectedCols = header.length;
  const focusIdx = header.indexOf(FOCUS_COLUMN);
  const styleIdx = header.indexOf(STYLE_COLUMN);

  if (focusIdx === -1 || styleIdx === -1) {
    console.error(`✗ Could not find required columns in header.`);
    console.error(`  Looking for "${FOCUS_COLUMN}" and "${STYLE_COLUMN}".`);
    console.error(`  Header has: ${header.join(" | ")}`);
    process.exitCode = 1;
    return;
  }

  const outLines = [header.join("\t")];
  const warnings = [];
  let rowCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    // Skip a stray blank line but never silently drop a real row.
    if (raw === "") continue;
    rowCount++;

    const cells = raw.split("\t");
    const name = cells[0] || `(row ${i + 1})`;

    if (cells.length !== expectedCols) {
      warnings.push(
        `Row ${i + 1} (${name}): had ${cells.length} columns, expected ${expectedCols} — left unchanged.`
      );
      outLines.push(raw);
      continue;
    }

    const cleanedFocus = cleanFocusList(splitCell(cells[focusIdx])).join(SEP);
    const cleanedStyle = cleanStyleList(splitCell(cells[styleIdx])).join(SEP);

    // Sanity: a comma left inside a focus item usually means an uncleaned compound
    // string slipped through (e.g. "Depression, Relationship Issues, Parenting").
    if (/,/.test(cleanedFocus)) {
      warnings.push(
        `Row ${i + 1} (${name}): "${FOCUS_COLUMN}" still contains a comma after cleaning: "${cleanedFocus}"`
      );
    }

    cells[focusIdx] = cleanedFocus;
    cells[styleIdx] = cleanedStyle;
    outLines.push(cells.join("\t"));
  }

  const outText = outLines.join("\n") + (hadTrailingNewline ? "\n" : "");
  await writeFile(OUTPUT_FILE, outText);

  console.log("First Session — parent-shareable TSV cleanup");
  console.log("--------------------------------------------");
  console.log(`Input : ${INPUT_FILE}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(`Rows processed: ${rowCount}`);
  console.log(`Columns preserved: ${expectedCols}`);
  console.log(`Cleaned columns: "${FOCUS_COLUMN}" (idx ${focusIdx}), "${STYLE_COLUMN}" (idx ${styleIdx})`);

  if (warnings.length) {
    console.log(`\n⚠  ${warnings.length} row(s) need a closer look:`);
    for (const w of warnings) console.log(`   - ${w}`);
  } else {
    console.log("\n✓ All rows cleaned cleanly (≤3 items per cleaned column, no leftover compounds).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
