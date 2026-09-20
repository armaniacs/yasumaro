//! Tag cooccurrence core for Yasumaro dashboards, compiled to WebAssembly.
//!
//! Exact port of `computeTagCooccurrence` and `narrowEntriesToTopTags` in
//! `src/dashboard/tagCooccurrence.ts` (see `cooccur.rs` for the parity
//! contracts, including the deliberate `|`-in-tag quirk handling which lives
//! in the JS wrapper, and the `MAX_TAGS_PER_RECORD` fail-safe cap).
//!
//! JS-semantics fidelity: the TS implementation works on JS strings (UTF-16
//! code units). The core operates on `&str` with JS-defined whitespace and
//! UTF-16-order comparison (see `cooccur.rs`); lone surrogates cannot
//! survive the `&str` boundary and become U+FFFD (same caveat as the
//! textrank/sentence-dedup crates).
//!
//! Interface shape: the caller joins the records' raw `tags` strings with
//! `'\n'` and sends the bundle once (a single JS→WASM string copy) plus the
//! record count. The O(T^2) pair scan runs entirely inside WASM; only a
//! small string table plus integer arrays cross back via serde. The count
//! doubles as a split-agreement gate: a raw tags string containing `'\n'`
//! would split into more pieces than records, which rejects with an error
//! so the wrapper falls back to the TS path rather than emitting shifted
//! output (same gate contract as the sentence-dedup crate).

mod cooccur;

use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Result of `computeCooccurrence`: the tag table in first-seen order with
/// per-tag record counts, plus edges as index pairs (pair members in
/// UTF-16 order) with weights. The JS wrapper maps indices back to tag
/// strings and reproduces the TS edge-key decoding exactly (see index.ts).
#[derive(Serialize)]
struct CooccurResult {
    tags: Vec<String>,
    counts: Vec<u32>,
    #[serde(rename = "edgeA")]
    edge_a: Vec<u32>,
    #[serde(rename = "edgeB")]
    edge_b: Vec<u32>,
    weights: Vec<u32>,
}

/// Result of `narrowToTopTags`: `unchanged` mirrors the TS early return
/// (unique-tag count already within `limit` — the wrapper returns the input
/// array by reference); otherwise `joined` carries the per-record rebuilt
/// tag strings (`#tag` space-joined) `\n`-joined in input order.
#[derive(Serialize)]
struct NarrowResult {
    unchanged: bool,
    joined: String,
}

fn split_records<'a>(joined: &'a str, entry_count: u32) -> Result<Vec<&'a str>, String> {
    let count = entry_count as usize;
    if count == 0 {
        if joined.is_empty() {
            return Ok(Vec::new());
        }
        return Err("tag-cooccur: entry_count is 0 but joined input is not empty".to_string());
    }
    let pieces: Vec<&str> = joined.split('\n').collect();
    if pieces.len() != count {
        return Err(format!(
            "tag-cooccur: split mismatch ({} pieces vs {} records — a raw tags string may contain '\\n')",
            pieces.len(),
            count
        ));
    }
    Ok(pieces)
}

/// Computes tag cooccurrence over `entry_count` raw tags strings
/// `\n`-joined into `joined`.
///
/// Mirrors `computeTagCooccurrence(entries)` where each entry contributes
/// its raw `tags` string (`null` normalized to `""` by the wrapper).
#[wasm_bindgen(js_name = computeCooccurrence)]
pub fn compute_cooccurrence(joined: &str, entry_count: u32) -> Result<JsValue, JsValue> {
    let records = split_records(joined, entry_count).map_err(|e| JsValue::from_str(e.as_str()))?;
    let out = cooccur::compute_core(&records);
    serde_wasm_bindgen::to_value(&CooccurResult {
        tags: out.tags,
        counts: out.counts,
        edge_a: out.edge_a,
        edge_b: out.edge_b,
        weights: out.weights,
    })
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Narrows records to the top-`limit` cross-record tags.
///
/// Mirrors `narrowEntriesToTopTags(entries, limit)`. `limit` arrives as u32;
/// the wrapper bypasses non-integer/negative limits to the TS path because
/// the JS→WASM boundary would silently wrap them via ToUint32.
#[wasm_bindgen(js_name = narrowToTopTags)]
pub fn narrow_to_top_tags(
    joined: &str,
    entry_count: u32,
    limit: u32,
) -> Result<JsValue, JsValue> {
    let records = split_records(joined, entry_count).map_err(|e| JsValue::from_str(e.as_str()))?;
    let out = cooccur::narrow_core(&records, limit as usize);
    serde_wasm_bindgen::to_value(&NarrowResult {
        unchanged: out.unchanged,
        joined: out.joined,
    })
    .map_err(|e| JsValue::from_str(&e.to_string()))
}
