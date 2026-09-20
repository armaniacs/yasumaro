//! TextRank sentence extraction for Yasumaro, compiled to WebAssembly.
//!
//! Exact port of `src/utils/sentenceExtractor.ts` (`extractSentences` +
//! `buildSentenceGraph` + `textRank`), including its local `toWordSet` (which
//! deliberately differs from `src/utils/text/tokenizer.ts`'s variant — see
//! that file) and the VULN-051 input cap (`MAX_SENTENCES_FOR_TEXTRANK` = 200,
//! kept in sync with `src/utils/computeLimits.ts`; the TS wrapper enforces
//! the same cap, this is defense in depth so the WASM path can never become
//! a cap bypass).
//!
//! JS-semantics fidelity: the TS implementation works on JS strings (UTF-16
//! code units — `.length`, `charAt` bigrams, `\s`-based trim/split). To stay
//! behavior-identical, the core operates on UTF-16 code units end to end
//! (see `jsstring.rs`); lone surrogates cannot survive the &str boundary and
//! become U+FFFD (see jsstring.rs's caveat). All WASM-visible functions
//! return `Result<_, JsValue>` so the TS wrapper can distinguish parameter
//! errors from extraction results and fall back to the TS path.
//!
//! Interface shape: `extractTopIndices` takes the full text and returns the
//! selected sentence indices PLUS the total sentence count the core split
//! the text into. The expensive part (O(n^2) similarity matrix + PageRank)
//! runs entirely inside WASM with one string copy in and a small integer
//! array out; the caller re-splits sentences on the JS side (cheap, single
//! pass) to map indices back to strings, and uses the count to detect any
//! split disagreement between the two implementations before mapping.

mod jsstring;
mod textrank;
mod tokenize;

use wasm_bindgen::prelude::*;

/// Result of `extractTopIndices`: the selected sentence indices (into the
/// core's own `splitSentences(text)`, in selection order) and the total
/// number of sentences that split produced. Exposing the count lets the TS
/// wrapper verify its own split agrees before mapping indices to strings —
/// an in-range index from a disagreeing split would otherwise silently map
/// to the wrong sentence.
#[wasm_bindgen]
pub struct TopIndicesResult {
    indices: Vec<u32>,
    sentence_count: usize,
}

#[wasm_bindgen]
impl TopIndicesResult {
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }

    #[wasm_bindgen(getter, js_name = sentenceCount)]
    pub fn sentence_count(&self) -> usize {
        self.sentence_count
    }
}

/// Extracts the top-K sentences' indices from `text` using TextRank.
///
/// Mirrors `extractSentences(text, { topK, minLength, similarityThreshold })`
/// from sentenceExtractor.ts.
///
/// Errors (JS receives a rejected promise / thrown Error via the wrapper):
/// - `top_k == 0`: the TS original's `sorted.slice(0, 0)` degenerates to an
///   empty result; the wrapper treats this as a call failure and falls back
///   to the TS path, so the quirk is preserved rather than reimplemented.
#[wasm_bindgen(js_name = extractTopIndices)]
pub fn extract_top_indices(
    text: &str,
    top_k: u32,
    min_length: u32,
    similarity_threshold: f64,
) -> Result<TopIndicesResult, JsValue> {
    if top_k == 0 {
        return Err(JsValue::from_str("textrank: top_k must be >= 1"));
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let (indices, sentence_count) = textrank::extract_core(
        &units,
        top_k as usize,
        min_length as usize,
        similarity_threshold,
    );
    Ok(TopIndicesResult {
        indices,
        sentence_count,
    })
}
