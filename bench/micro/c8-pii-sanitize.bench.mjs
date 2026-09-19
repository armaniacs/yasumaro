/**
 * c8 — PII sanitizer: TS regex vs WASM vs the removed TS-second-pass hybrid.
 *
 * Priced the TS regex backstop that piiSanitizeHybrid.ts used to run after
 * the WASM pass: the two-pass hybrid measured ≈ TS-only (the backstop
 * consumed the entire WASM speedup), which is why the backstop was removed
 * (see piiSanitizeHybrid.ts's module doc for the decision and gates). The
 * three variants stay so the comparison stays reproducible: c8-wasm is the
 * shipped success path, c8-ts the failure fallback, c8-hybrid the removed
 * two-pass composition kept as a regression reference for anyone tempted to
 * re-add a runtime backstop.
 *
 * Fixture is realistic extracted-article HTML with one email+phone pair per
 * ~2KB (contact-bearing pages; the worst realistic density for the masking
 * work, not for scanning). Sizes bracket the pipeline's real inputs: the
 * sanitizer rejects >64KB inputs (MAX_PII_INPUT_SIZE), so L stays under the
 * cap.
 */
import { importFromSource } from '../harness/bundle.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let sanitizeRegex;
let sanitizePii;
let initWasmModule;
let initPromise;

async function ensureLoaded() {
  if (!sanitizeRegex) {
    sanitizeRegex = (await importFromSource('src/utils/piiSanitizer.ts')).sanitizeRegex;
  }
  if (!sanitizePii) {
    const glue = await importFromSource('src/wasm/pii-sanitizer/piiSanitizerWasm.js');
    sanitizePii = glue.sanitizePii;
    initWasmModule = glue.default;
  }
  if (!initPromise) {
    // Mirror the parity tests: read the committed binary from disk instead of
    // going through initPiiSanitizerWasm(), which requires chrome.runtime.
    const bytes = await readFile(
      resolve(projectRoot, 'src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm'),
    );
    initPromise = initWasmModule({ module_or_path: bytes });
  }
  return initPromise;
}

const PARAGRAPH =
  'The quick brown fox jumps over the lazy dog while researchers publish new findings about ' +
  'browser performance, memory usage, and the subtle art of measuring wall-clock latency in ' +
  'realistic workloads. ';

/** Realistic extracted-article HTML at `kb` kilobytes, 1 email+phone pair per ~2KB. */
function buildContent(kb) {
  const target = kb * 1024;
  const parts = [];
  let size = 0;
  let i = 0;
  while (size < target) {
    i++;
    let para = `<p>${PARAGRAPH} (block ${i})</p>`;
    if (i % 2 === 0) {
      para += '<p>Contact research-admin@example.com or call 03-1234-5678 for the dataset.</p>';
    }
    parts.push(para);
    size += para.length;
  }
  return parts.join('\n');
}

// L stays under the sanitizer's 64KB input cap (MAX_PII_INPUT_SIZE = 65536
// chars) — above it sanitizeRegex rejects without scanning, which would make
// c8-ts measure the rejection path instead of the scan.
const SIZES = [
  { key: '8KB', n: 8 },
  { key: '32KB', n: 32 },
  { key: '60KB', n: 60 },
];

function makeDefinition(id, description, runFn) {
  return {
    id,
    description,
    counters: [],
    sizes: SIZES,
    async setup(size) {
      await ensureLoaded();
      return { text: buildContent(size.n) };
    },
    async run(ctx) {
      return runFn(ctx.text);
    },
  };
}

export const c8Ts = makeDefinition(
  'c8-ts',
  'PII sanitizeRegex TS-only (WASM failure fallback path)',
  async (text) => sanitizeRegex(text, {}),
);

export const c8Wasm = makeDefinition(
  'c8-wasm',
  'PII sanitizePii WASM core only (proposed hybrid-without-backstop state)',
  (text) => sanitizePii(text),
);

export const c8Hybrid = makeDefinition(
  'c8-hybrid',
  'PII hybrid as it shipped before the backstop removal: WASM pass + TS regex second pass over masked text',
  async (text) => {
    const wasm = sanitizePii(text);
    const ts = await sanitizeRegex(wasm.text, {});
    return [...wasm.maskedItems, ...ts.maskedItems];
  },
);
