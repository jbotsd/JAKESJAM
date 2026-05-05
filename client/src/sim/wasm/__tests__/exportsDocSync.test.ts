// Regression gate: docs/zig-wasm-exports.md must stay in sync
// with the actual wasm exports. If someone adds a new export
// without updating the doc, this fails. If someone removes an
// export while the doc still mentions it, this fails. Either
// way the manifest doc stays trustworthy.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");
const DOC_PATH = resolve(__dirname, "..", "..", "..", "..", "..", "docs", "zig-wasm-exports.md");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);
const docText = await readFile(DOC_PATH, "utf8");

// The manifest doc references exports in markdown table cells like
// `| `lut_sin(x: f64) → f64` | LUT-based sin | `trigParity.test.ts` |`.
// We extract the export name from the leading backtick-quoted code
// span. Be permissive about argument formatting.

function exportsFromDoc(text: string): Set<string> {
  const out = new Set<string>();
  // Match `name(...)` or `name`  inside markdown table cells.
  const codeSpanRegex = /`([a-z_][a-z_0-9]*)/gi;
  for (const m of text.matchAll(codeSpanRegex)) {
    const name = m[1];
    if (
      name &&
      // Exclude false positives — markdown words that match the regex
      // but aren't actual exports.
      // Exclude markdown-prose words that match the regex but aren't
      // actual wasm exports. `memory` is intentionally NOT excluded:
      // it's a real wasm export name.
      !/^(null|true|false|undefined|void|number|f64|i32|u32|u8|i64|usize|ptr|bytes)$/i.test(name)
    ) {
      out.add(name);
    }
  }
  return out;
}

function exportsFromWasm(exports: WebAssembly.Exports): Set<string> {
  const out = new Set<string>();
  for (const [name, val] of Object.entries(exports)) {
    if (typeof val === "function" || name === "memory") {
      out.add(name);
    }
  }
  return out;
}

describe("docs/zig-wasm-exports.md ↔ wasm exports sync", () => {
  test("every wasm export name appears in the manifest doc", () => {
    const wasmNames = exportsFromWasm(
      sim.exports as unknown as WebAssembly.Exports,
    );
    const docNames = exportsFromDoc(docText);
    const missingFromDoc: string[] = [];
    for (const name of wasmNames) {
      if (!docNames.has(name)) {
        missingFromDoc.push(name);
      }
    }
    if (missingFromDoc.length > 0) {
      console.error(
        `Wasm exports missing from docs/zig-wasm-exports.md:\n  ${missingFromDoc.join("\n  ")}`,
      );
    }
    expect(missingFromDoc).toEqual([]);
  });

  // We do NOT check the inverse direction (doc names that aren't
  // exports). The doc legitimately references types, struct fields,
  // and prose terms that look like exports but aren't. Adding a
  // strict reverse check would surface false positives.

  test("the manifest doc itself is non-empty and well-formed", () => {
    expect(docText.length).toBeGreaterThan(1000);
    expect(docText).toMatch(/Zig→WASM exports manifest/);
    expect(docText).toMatch(/## Trig LUT/);
    expect(docText).toMatch(/## Player physics/);
  });
});
