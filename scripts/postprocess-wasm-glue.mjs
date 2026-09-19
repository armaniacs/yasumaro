#!/usr/bin/env node
/**
 * Post-processes the wasm-bindgen-generated glue file after `wasm-pack
 * build`, before it's copied into src/wasm/pii-sanitizer/.
 *
 * Two fixes, both required because Vite statically scans source text for
 * `new URL(..., import.meta.url)` and inlines the referenced asset as a
 * `data:` URI whenever the containing bundle builds as a single-file IIFE
 * (as the background entrypoint does — see wxt.config.ts's
 * `codeSplitting: false`). This happens regardless of whether that code
 * path is actually reachable at runtime, so the dead default-argument
 * branch in wasm-bindgen's generated `__wbg_init` still triggers inlining:
 *
 * 1. Rewrite the `.d.ts` self-reference to match the renamed file
 *    (piiSanitizerWasm.d.ts, not pii_sanitizer.d.ts).
 * 2. Remove the `new URL('pii_sanitizer_bg.wasm', import.meta.url)` default
 *    fallback branch entirely. This branch is unreachable in production —
 *    src/wasm/pii-sanitizer/index.ts always passes an explicit
 *    `module_or_path` (chrome.runtime.getURL(...) in the extension, a
 *    `Uint8Array` read from disk in tests/bench.ts) — but Vite's static
 *    scan doesn't know that, so the mere presence of the `new URL(...)`
 *    call causes wasm-pack's ~47KB binary to be duplicated inline as
 *    base64 inside background.js, silently ballooning bundle size AND
 *    (more importantly) not actually fixing the CSP problem the rewrite in
 *    index.ts exists to fix, since Vite may inline `data:` regardless.
 *    Throwing here instead makes any accidental future call without an
 *    explicit `module_or_path` fail loudly at runtime rather than
 *    reintroducing the inlined-asset problem silently.
 *
 * Run as part of `npm run build:wasm`, not directly.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const GLUE_PATH = 'wasm/pii-sanitizer/pkg/pii_sanitizer.js';
const OUT_PATH = 'src/wasm/pii-sanitizer/piiSanitizerWasm.js';

let source = readFileSync(GLUE_PATH, 'utf-8');

source = source.replace('./pii_sanitizer.d.ts', './piiSanitizerWasm.d.ts');

const defaultUrlBranch = "if (module_or_path === undefined) {\n        module_or_path = new URL('pii_sanitizer_bg.wasm', import.meta.url);\n    }";
if (!source.includes(defaultUrlBranch)) {
    throw new Error(
        'postprocess-wasm-glue: expected default-URL branch not found — wasm-bindgen output format may have ' +
            'changed. Update this script\'s replacement string to match, then re-verify the CSP-safety fix ' +
            '(no `new URL(..., import.meta.url)` should remain in the output file).'
    );
}
source = source.replace(
    defaultUrlBranch,
    "if (module_or_path === undefined) {\n        throw new Error('pii-sanitizer wasm: module_or_path is required (no default asset URL — see postprocess-wasm-glue.mjs)');\n    }"
);

if (source.includes('import.meta.url')) {
    throw new Error(
        'postprocess-wasm-glue: `import.meta.url` still present after processing — Vite will inline the wasm ' +
            'as a data: URI again. Find and remove/guard the remaining reference.'
    );
}

writeFileSync(OUT_PATH, source);
console.log(`wrote ${OUT_PATH} (CSP-unsafe new URL(...) fallback removed)`);
