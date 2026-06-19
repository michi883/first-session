// Minimal, dependency-free CSV writer.
//
// We hand-roll RFC-4180 quoting rather than pull in a CSV library: the record
// shape is fixed (FIELD_ORDER) and the only tricky values are long raw-text
// blobs and arrays, both handled below.

import { FIELD_ORDER, ARRAY_FIELDS } from "./schema.js";

/** Quote a single CSV cell if it contains a comma, quote, or newline. */
function quoteCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Flatten one record's field to a CSV-safe scalar string. */
function flattenField(record, field) {
  const v = record[field];
  if (Array.isArray(v)) return v.join("; "); // ARRAY_FIELDS joined with "; "
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v == null) return "";
  return v;
}

/**
 * Serialize an array of records into a CSV string using FIELD_ORDER as columns.
 */
export function recordsToCsv(records) {
  const header = FIELD_ORDER.map(quoteCell).join(",");
  const rows = records.map((rec) =>
    FIELD_ORDER.map((field) => quoteCell(flattenField(rec, field))).join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

// Re-export so callers can reason about column types if needed.
export { ARRAY_FIELDS };
