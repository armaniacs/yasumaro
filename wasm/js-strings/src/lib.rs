//! Shared JavaScript string semantics over UTF-16 code units, used by the
//! textrank and sentence-dedup WASM cores.
//!
//! The two cores' `jsstring.rs` / `tokenize.rs` files were near-clones (the
//! only differences were docs, the sentence-split variant, and the two
//! tokenizer parameters now on `tokenize::TokenizeOptions`); both now depend
//! on this crate instead, so whitespace/lowercase/bigram/Jaccard fixes land
//! in one place.

pub mod jsstring;
pub mod tokenize;

pub use jsstring::{
    contains_japanese, is_js_ws, is_js_ws_code, is_js_ws_scalar, is_sentence_delimiter,
    is_word_separator, js_trim, split_sentence_parts, split_sentence_ranges, to_lowercase_utf16,
    SentencePart,
};
pub use tokenize::{
    jaccard_similarity, strip_trailing_delimiter, to_word_set, BigramSource, TokenizeOptions,
    WordSet, DEDUP_TOKENIZE, TEXTRANK_TOKENIZE,
};
