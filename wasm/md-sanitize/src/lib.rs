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

// ---------------------------------------------------------------------------
// PBI-23 transfer-optimization probes: alternative batch transfer contracts.
// All three keep the newline-safety guarantee (no delimiter-based split, so
// embedded `\n` can never trip a gate) and the UTF-16/UTF-8 semantics of the
// `String` boundary (JS `TextEncoder` folds lone surrogates to U+FFFD before
// Rust sees them; the core only treats ASCII delimiters specially, so valid
// Unicode scalars — including astral-plane characters — behave identically
// to the TS UTF-16 walk). Malformed input fails the call so the wrapper
// falls back to the TS path instead of emitting wrong output.
// ---------------------------------------------------------------------------

/// Reads one `[u32 LE byte-len][UTF-8 bytes]` frame. Length-delimited, so
/// embedded newlines / `]` / `)` bytes are payload, never framing.
fn read_frame<'a>(data: &'a [u8], pos: &mut usize) -> Result<&'a str, String> {
    if *pos + 4 > data.len() {
        return Err(format!("framed batch truncated at frame header (pos {})", pos));
    }
    let len =
        u32::from_le_bytes([data[*pos], data[*pos + 1], data[*pos + 2], data[*pos + 3]]) as usize;
    *pos += 4;
    if *pos + len > data.len() {
        return Err(format!("framed batch truncated at frame body (pos {}, len {})", pos, len));
    }
    let slice = &data[*pos..*pos + len];
    *pos += len;
    std::str::from_utf8(slice).map_err(|e| format!("framed batch invalid UTF-8: {e}"))
}

fn write_frame(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

/// (a) Framed-bytes batch: ONE bulk `Uint8Array` in (`&[u8]` → single
/// malloc+memcpy, no externref, no serde reflection) and one out. Replaces
/// 2N per-element wasm mallocs + N externref allocs + the serde iterator
/// protocol with 2 bulk copies; per-record UTF-8 encode/decode necessarily
/// remains (it is inherent to crossing into WASM at all).
#[wasm_bindgen(js_name = sanitizeBatchFramed)]
pub fn sanitize_batch_framed(data: Vec<u8>) -> Result<Vec<u8>, JsValue> {
    let mut pos = 0usize;
    let mut out = Vec::with_capacity(data.len() + 16);
    while pos < data.len() {
        let s = read_frame(&data, &mut pos).map_err(|e| JsValue::from_str(&e))?;
        let clean = sanitize::sanitize_for_obsidian(s);
        write_frame(&mut out, clean.as_bytes());
    }
    Ok(out)
}

/// (a2) Framed-bytes batch+join: framed input like (a), single `String` out.
/// Mirrors `entries.map(sanitizeForObsidian).join(separator)` with one bulk
/// copy in and one string decode out.
#[wasm_bindgen(js_name = sanitizeBatchFramedAndJoin)]
pub fn sanitize_batch_framed_and_join(data: Vec<u8>, separator: String) -> Result<String, JsValue> {
    let mut pos = 0usize;
    let mut parts = Vec::new();
    while pos < data.len() {
        let s = read_frame(&data, &mut pos).map_err(|e| JsValue::from_str(&e))?;
        parts.push(sanitize::sanitize_for_obsidian(s));
    }
    Ok(parts.join(&separator))
}

/// (b) Serde-bytes batch: JS pre-encodes entries to `Uint8Array`s and the
/// array crosses via `serde_wasm_bindgen` (`Vec<Vec<u8>>` both directions).
/// Keeps the serde reflection protocol but drops the per-string glue
/// encode/decode, isolating how much of the baseline cost is reflection vs
/// UTF-8 transcoding.
#[wasm_bindgen(js_name = sanitizeBatchBytes)]
pub fn sanitize_batch_bytes(inputs: JsValue) -> Result<JsValue, JsValue> {
    let blobs: Vec<Vec<u8>> =
        serde_wasm_bindgen::from_value(inputs).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut out = Vec::with_capacity(blobs.len());
    for b in &blobs {
        let s = std::str::from_utf8(b)
            .map_err(|e| JsValue::from_str(&format!("byte batch invalid UTF-8: {e}")))?;
        out.push(sanitize::sanitize_for_obsidian(s).into_bytes());
    }
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod frame_tests {
    use super::*;

    fn frame_all(entries: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        for e in entries {
            write_frame(&mut buf, e.as_bytes());
        }
        buf
    }

    fn read_all(data: &[u8]) -> Vec<String> {
        let mut pos = 0usize;
        let mut out = Vec::new();
        while pos < data.len() {
            out.push(read_frame(data, &mut pos).expect("frame").to_string());
        }
        out
    }

    #[test]
    fn frames_round_trip_with_newlines_and_empty() {
        let entries = vec![
            "a\nb\nc",
            "",
            "\n\n",
            "[[w]]\n[t](https://x?a=1&b=2)",
            "[t](javascript:alert(1))",
            "🎉あいう",
        ];
        assert_eq!(read_all(&frame_all(&entries)), entries);
    }

    #[test]
    fn truncated_input_errors_instead_of_panicking() {
        let mut buf = frame_all(&["hello"]);
        buf.truncate(buf.len() - 2);
        let mut pos = 0usize;
        assert!(read_frame(&buf, &mut pos).is_err());
        let mut pos = 0usize;
        assert!(read_frame(&buf[..2], &mut pos).is_err());
    }
}
