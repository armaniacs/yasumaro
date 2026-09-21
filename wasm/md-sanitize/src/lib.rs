//! Markdown sanitization core for Yasumaro exports, compiled to WebAssembly.
//!
//! Exact port of `sanitizeForObsidian` (plus its two helper stages) in
//! `src/utils/markdownSanitizer.ts` (see `sanitize.rs` for the parity
//! contracts, including the deliberate `[^)]+`-stops-at-first-`)` behavior
//! and the leftmost-match bracket-consumption quirk).
//!
//! JS-semantics fidelity: the TS implementation works on JS strings (UTF-16
//! code units). The core scans bytes but only treats ASCII delimiters
//! specially, so every valid Unicode scalar behaves identically; lone
//! surrogates cannot survive the `&str` boundary and become U+FFFD (same
//! caveat as the textrank/sentence-dedup/tag-cooccur crates).
//!
//! Transfer contract (newline-safe by design): export bodies contain `\n`,
//! so the tag-cooccur `\n`-joined single-string transfer with its
//! split-agreement gate is unusable here — any embedded newline would trip
//! the gate and force every export through the TS fallback. Instead the
//! batch entry points exchange a JS string ARRAY via `serde_wasm_bindgen`
//! (`Vec<String>` in both directions), which carries embedded newlines,
//! `]`/`)` delimiters, and empty strings without escaping or ambiguity.
//! The array length is the record count: no gate, no split, no shift risk.
//! Single-string inputs use the plain `String` boundary, which is equally
//! newline-safe.

mod sanitize;

use wasm_bindgen::prelude::*;

/// Sanitizes one string exactly like `sanitizeForObsidian`.
#[wasm_bindgen(js_name = sanitizeForObsidian)]
pub fn sanitize_for_obsidian(input: String) -> String {
    sanitize::sanitize_for_obsidian(&input)
}

/// Sanitizes every entry of a JS string array in a single call and returns
/// a JS string array (same order, same length).
///
/// Newlines inside entries are preserved (see the module-level transfer
/// contract): unlike the `\n`-joined transfer of the tag-cooccur crate,
/// this entry point never splits on content bytes.
#[wasm_bindgen(js_name = sanitizeBatch)]
pub fn sanitize_batch(inputs: JsValue) -> Result<JsValue, JsValue> {
    let texts: Vec<String> =
        serde_wasm_bindgen::from_value(inputs).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let out = sanitize::sanitize_batch(&texts);
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Sanitizes every entry of a JS string array and joins the results with
/// `separator` inside WASM, returning a single string.
///
/// Mirrors `entries.map(sanitizeForObsidian).join(separator)` (e.g. the
/// `'\n---\n'` aggregation in `exportLogsService.exportMarkdown`) while
/// crossing the JS→WASM boundary exactly once in each direction.
#[wasm_bindgen(js_name = sanitizeBatchAndJoin)]
pub fn sanitize_batch_and_join(inputs: JsValue, separator: String) -> Result<JsValue, JsValue> {
    let texts: Vec<String> =
        serde_wasm_bindgen::from_value(inputs).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let out = sanitize::sanitize_batch_and_join(&texts, &separator);
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}
