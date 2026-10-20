/**
 * wasmAssets.ts
 * Single source of truth (SSOT) for the sqlite-wasm asset URLs (PBI 06).
 *
 * The `new URL(specifier, import.meta.url)` form is required here: Vite (and
 * rolldown) resolve the bare package subpath to the actual .wasm binary at
 * build time. On Chromium that becomes an emitted asset file
 * (assetsInlineLimit: 0 in wxt.config.ts); on Firefox the single-file lib
 * builds inline it as a `data:` URI, which the extension CSP blocks and
 * stripInlinedWasmPlugins (wxt.config.ts) strips — the Firefox engine then
 * loads the stable public asset via the INIT override
 * (see sqliteBoot.ts's setSqliteWasmUrlOverride). Call sites must reference
 * these entries instead of re-inlining the literals, so a crate rename or
 * build-output change updates one entry instead of one per file.
 *
 * Import-graph caution: this module is bundled into the OPFS worker graph,
 * the offscreen document graph, and (via the Firefox-only dynamic import in
 * src/background/service-worker.ts) the Firefox background graph. Do not add
 * a static import from the Chromium background: its FIREFOX branch is
 * dead-code eliminated today, so a static import would newly pull both wasm
 * asset references into a build that never loads them.
 *
 * The crate wrappers (src/wasm/<crate>/index.ts) are deliberately NOT listed
 * here: they already funnel through initExtensionWasm -> extensionWasmUrl
 * (src/wasm/initWasm.ts), the single point that builds `wasm/<fileName>` via
 * chrome.runtime.getURL for the public/ wasm binaries.
 */
export const WASM_ASSET_URLS = {
    /** OPFS engine binary (wa-sqlite.wasm) loaded by the worker-side engines. */
    opfsEngineWasm: new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href,
    /** IDB engine binary (wa-sqlite-async.wasm) loaded by the in-page engine. */
    idbEngineWasm: new URL('@subframe7536/sqlite-wasm/wasm-async', import.meta.url).href,
    /**
     * Firefox-only public path for the IDB engine binary (copied to
     * dist/wasm/ by wxt.config.ts's build:publicAssets hook). Resolved via
     * chrome.runtime.getURL in the INIT override so the engine fetches a
     * same-origin file URL instead of the CSP-blocked data: inline.
     */
    idbEngineWasmPublicPath: 'wasm/wa-sqlite-async.wasm',
} as const;
