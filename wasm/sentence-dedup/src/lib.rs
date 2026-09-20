//! Sentence-level redundancy reduction for Yasumaro, compiled to WebAssembly.
//!
//! Exact port of `deduplicateContent` in `src/utils/contentDeduplicator.ts`
//! (the MMR-style redundancy reduction step of the content extractor), built
//! on `src/utils/text/tokenizer.ts`'s `toWordSet` and
//! `src/utils/text/similarity.ts`'s Jaccard similarity. Note the deliberate
//! tokenizer difference from the textrank crate: the dedup path strips one
//! trailing sentence delimiter and takes bigrams from the ORIGINAL-case
//! cleaned text (see tokenize.rs), and its local `splitSentences` keeps
//! delimiters attached with the consumed `\s*` stored separately (see
//! jsstring.rs).
//!
//! JS-semantics fidelity: the TS implementation works on JS strings (UTF-16
//! code units — `.length`, `charAt` bigrams, `\s`-based split). To stay
//! behavior-identical, the core operates on UTF-16 code units end to end
//! (see `jsstring.rs`); lone surrogates cannot survive the &str boundary
//! and become U+FFFD (see jsstring.rs's caveat). The WASM-visible function
//! returns `Result<_, JsValue>` so the TS wrapper can distinguish parameter
//! errors from results and fall back to the TS path.
//!
//! Interface shape: `deduplicateIndices` takes the full text and returns the
//! kept part indices PLUS the total part count the core split the text into
//! (same contract as the textrank crate). The expensive part — the O(n^2)
//! Jaccard pair scan over per-sentence word sets — runs entirely inside
//! WASM with one string copy in and a small integer array out; the caller
//! re-splits on the JS side with the IDENTICAL TS `splitSentences` (cheap,
//! single pass) to map indices back to strings, and uses the count to
//! detect any split disagreement between the two implementations before
//! reconstructing. One WASM→JS divergence is deliberate: the pair scan is
//! capped at `MAX_SENTENCES_FOR_DEDUP` (fail-open beyond it) to bound the
//! quadratic work the uncapped TS reference would spend on delimiter-dense
//! pages — see dedup.rs.

mod dedup;
mod jsstring;
mod tokenize;

use wasm_bindgen::prelude::*;

/// Result of `deduplicateIndices`: the kept part indices (into the core's
/// own split, in original order) and the total number of parts that split
/// produced. Exposing the count lets the TS wrapper verify its own split
/// agrees before mapping indices back to strings — an in-range index from a
/// disagreeing split would otherwise silently reconstruct the wrong text.
#[wasm_bindgen]
pub struct DedupIndicesResult {
    indices: Vec<u32>,
    sentence_count: usize,
}

#[wasm_bindgen]
impl DedupIndicesResult {
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }

    #[wasm_bindgen(getter, js_name = sentenceCount)]
    pub fn sentence_count(&self) -> usize {
        self.sentence_count
    }
}

/// Computes the kept sentence indices for `text` using Jaccard-based
/// redundancy reduction.
///
/// Mirrors `deduplicateContent(text, { threshold, minLength })` from
/// contentDeduplicator.ts.
///
/// Errors (JS receives a thrown Error via the wrapper, which falls back to
/// the TS path):
/// - `threshold` is NaN: the TS comparison `jaccard >= NaN` is always false
///   (keep everything), which is well-defined — but passing NaN across the
///   boundary invites silent misuse, so the core rejects it and the wrapper
///   bypasses NaN inputs to the TS path instead.
#[wasm_bindgen(js_name = deduplicateIndices)]
pub fn deduplicate_indices(
    text: &str,
    threshold: f64,
    min_length: u32,
) -> Result<DedupIndicesResult, JsValue> {
    if threshold.is_nan() {
        return Err(JsValue::from_str(
            "sentence-dedup: threshold must not be NaN",
        ));
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let (indices, sentence_count) = dedup::dedup_core(&units, threshold, min_length);
    Ok(DedupIndicesResult {
        indices,
        sentence_count,
    })
}
