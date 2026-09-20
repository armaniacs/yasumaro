#!/usr/bin/env node
/**
 * Post-processes the wasm-bindgen-generated glue files after `wasm-pack
 * build`, before they're copied into src/wasm/<crate>/.
 *
 * Two fixes per crate, both required because Vite statically scans source
 * text for `new URL(..., import.meta.url)` and inlines the referenced asset
 * as a `data:` URI whenever the containing bundle builds as a single-file
 * IIFE (as the background entrypoint does — see wxt.config.ts's
 * `codeSplitting: false`). This happens regardless of whether that code
 * path is actually reachable at runtime, so the dead default-argument
 * branch in wasm-bindgen's generated `__wbg_init` still triggers inlining:
 *
 * 1. Rewrite the `@ts-self-types` / d.ts self-reference to match the renamed
 *    file (<crate>Wasm.d.ts, not <crate>.d.ts).
 * 2. Remove the `new URL('<crate>_bg.wasm', import.meta.url)` default
 *    fallback branch entirely. This branch is unreachable in production —
 *    src/wasm/<crate>/index.ts always passes an explicit `module_or_path`
 *    (chrome.runtime.getURL(...) in the extension, a `Uint8Array` read from
 *    disk in tests/bench) — but Vite's static scan doesn't know that, so
 *    the mere presence of the `new URL(...)` call causes the ~40KB binary
 *    to be duplicated inline as base64 inside background.js, silently
 *    ballooning bundle size AND (more importantly) not actually fixing the
 *    CSP problem the rewrite in index.ts exists to fix, since Vite may
 *    inline `data:` regardless. Throwing here makes any accidental future
 *    call without an explicit `module_or_path` fail loudly at runtime
 *    rather than reintroducing the inlined-asset problem silently.
 *
 * Run as part of `npm run build:wasm`, not directly.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const CRATES = [
    {
        gluePath: 'wasm/pii-sanitizer/pkg/pii_sanitizer.js',
        outPath: 'src/wasm/pii-sanitizer/piiSanitizerWasm.js',
        dtsName: 'piiSanitizerWasm.d.ts',
        wasmName: 'pii_sanitizer_bg.wasm',
        crateLabel: 'pii-sanitizer',
    },
    {
        gluePath: 'wasm/textrank/pkg/textrank.js',
        outPath: 'src/wasm/textrank/textrankWasm.js',
        dtsName: 'textrankWasm.d.ts',
        wasmName: 'textrank_bg.wasm',
        crateLabel: 'textrank',
    },
];

for (const { gluePath, outPath, dtsName, wasmName, crateLabel } of CRATES) {
    let source = readFileSync(gluePath, 'utf-8');

    // Both the legacy `./<crate>.d.ts` import-style reference and the modern
    // `@ts-self-types` pragma are rewritten; only whichever is present changes.
    source = source.replaceAll(`./${wasmName.replace('_bg.wasm', '.d.ts')}`, `./${dtsName}`);

    const defaultUrlBranch =
        "if (module_or_path === undefined) {\n        module_or_path = new URL('" +
        wasmName +
        "', import.meta.url);\n    }";
    if (!source.includes(defaultUrlBranch)) {
        throw new Error(
            `postprocess-wasm-glue (${wasmName}): expected default-URL branch not found — wasm-bindgen ` +
                'output format may have changed. Update this script\'s replacement string to match, then ' +
                're-verify the CSP-safety fix (no `new URL(..., import.meta.url)` should remain in the ' +
                'output file).'
        );
    }
    source = source.replace(
        defaultUrlBranch,
        "if (module_or_path === undefined) {\n        throw new Error('" +
            crateLabel +
            " wasm: module_or_path is required (no default asset URL — see postprocess-wasm-glue.mjs)');\n    }"
    );

    if (source.includes('import.meta.url')) {
        throw new Error(
            `postprocess-wasm-glue (${wasmName}): \`import.meta.url\` still present after processing — ` +
                'Vite will inline the wasm as a data: URI again. Find and remove/guard the remaining ' +
                'reference.'
        );
    }

    writeFileSync(outPath, source);
    console.log(`wrote ${outPath} (CSP-unsafe new URL(...) fallback removed)`);
}
