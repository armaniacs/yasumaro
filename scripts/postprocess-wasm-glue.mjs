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
import { fileURLToPath } from 'node:url';
import { ROOT, loadManifest } from './wasm-crates.mjs';

// PBI 2026-09-21-18: the crate table is owned by wasm/crates.json; this file
// only derives the postprocess view (glue in -> processed glue out).
const CRATES = loadManifest({ root: ROOT }).crates.map(
    ({ gluePath, outPath, dtsName, wasmName, crateLabel }) => ({
        gluePath,
        outPath,
        dtsName,
        wasmName,
        crateLabel,
    })
);

/**
 * Pure glue transform (unit-testable): rewrites the d.ts self-reference to
 * the renamed file and replaces the unreachable `new URL(..., import.meta.url)`
 * default branch with a loud throw. Throws when the expected branch is absent
 * (wasm-bindgen format change) or `import.meta.url` survives.
 */
export function transformGlue(source, { dtsName, wasmName, crateLabel }) {
    // Both the legacy `./<crate>.d.ts` import-style reference and the modern
    // `@ts-self-types` pragma are rewritten; only whichever is present changes.
    let result = source.replaceAll(`./${wasmName.replace('_bg.wasm', '.d.ts')}`, `./${dtsName}`);

    const defaultUrlBranch =
        "if (module_or_path === undefined) {\n        module_or_path = new URL('" +
        wasmName +
        "', import.meta.url);\n    }";
    if (!result.includes(defaultUrlBranch)) {
        throw new Error(
            `postprocess-wasm-glue (${wasmName}): expected default-URL branch not found — wasm-bindgen ` +
                'output format may have changed. Update this script\'s replacement string to match, then ' +
                're-verify the CSP-safety fix (no `new URL(..., import.meta.url)` should remain in the ' +
                'output file).'
        );
    }
    result = result.replace(
        defaultUrlBranch,
        "if (module_or_path === undefined) {\n        throw new Error('" +
            crateLabel +
            " wasm: module_or_path is required (no default asset URL — see postprocess-wasm-glue.mjs)');\n    }"
    );

    if (result.includes('import.meta.url')) {
        throw new Error(
            `postprocess-wasm-glue (${wasmName}): \`import.meta.url\` still present after processing — ` +
                'Vite will inline the wasm as a data: URI again. Find and remove/guard the remaining ' +
                'reference.'
        );
    }
    return result;
}

export function processCrate({ gluePath, outPath, dtsName, wasmName, crateLabel }, { check = false } = {}) {
    const source = readFileSync(gluePath, 'utf-8');
    const processed = transformGlue(source, { dtsName, wasmName, crateLabel });
    if (check) {
        const committed = readFileSync(outPath, 'utf-8');
        const stale = committed !== processed;
        console.log(`${stale ? 'STALE' : 'OK'} ${outPath}`);
        return !stale;
    }
    writeFileSync(outPath, processed);
    console.log(`wrote ${outPath} (CSP-unsafe new URL(...) fallback removed)`);
    return true;
}

const invokedAsScript =
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) {
    // --check: report per-crate OK/STALE against the committed output without
    // writing (dry-run for the CI staleness gates).
    const check = process.argv.includes('--check');
    let fresh = true;
    for (const crate of CRATES) {
        if (!processCrate(crate, { check })) fresh = false;
    }
    if (!fresh) process.exit(1);
}
