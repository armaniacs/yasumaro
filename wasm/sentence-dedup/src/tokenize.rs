//! Word-set tokenization and Jaccard similarity for the dedup core,
//! mirroring the TS reference exactly:
//! - `toWordSet` from `src/utils/text/tokenizer.ts` (NOT the local variant
//!   in `sentenceExtractor.ts` that the textrank crate ports): one trailing
//!   sentence delimiter is stripped first, word tokens come from the
//!   lowercased text, and the character bigrams are taken from the
//!   ORIGINAL-case cleaned text (`getBigrams(cleaned)`, not
//!   `getBigrams(cleaned.toLowerCase())`).
//! - `jaccardSimilarity` from `src/utils/text/similarity.ts`.

use std::collections::HashSet;

use rustc_hash::FxBuildHasher;

use crate::jsstring::{
    contains_japanese, is_sentence_delimiter, is_word_separator, to_lowercase_utf16,
};

/// Word-set keyed by the raw UTF-16 token, hashed with FxHash. Only the
/// hasher differs from a default HashSet — membership semantics (and thus
/// Jaccard values) are identical to the TS `Set<string>` reference.
pub type WordSet = HashSet<Vec<u16>, FxBuildHasher>;

/// Strips ONE trailing sentence delimiter — mirrors
/// `sentence.replace(/[。！？.!?]$/, '')` (single `$`-anchored match; "。。"
/// loses only the last "。").
fn strip_trailing_delimiter(units: &[u16]) -> &[u16] {
    match units.last() {
        Some(&u) if is_sentence_delimiter(u) => &units[..units.len() - 1],
        _ => units,
    }
}

/// Tokenizes a sentence (UTF-16) into the word set used for Jaccard
/// similarity, mirroring tokenizer.ts's `toWordSet`:
/// 1. strip one trailing sentence delimiter,
/// 2. lowercase, split on the separator class, keep tokens whose UTF-16
///    length is >= 2 (so a single astral character passes, exactly like
///    JS `.length`),
/// 3. when the cleaned text contains Japanese, add character bigrams of the
///    whole ORIGINAL-case cleaned text (order is irrelevant — this is a set;
///    case preservation is deliberate JS parity: `getBigrams(cleaned)`).
pub fn to_word_set(units: &[u16]) -> WordSet {
    let cleaned = strip_trailing_delimiter(units);
    let lowered = to_lowercase_utf16(cleaned);
    // Upper bound: every unit could start a token in the worst case; the
    // capacity reserve avoids rehash growth during the scan.
    let mut set: WordSet = HashSet::with_capacity_and_hasher(cleaned.len(), FxBuildHasher);

    let mut token: Vec<u16> = Vec::new();
    for &u in &lowered {
        if is_word_separator(u) {
            if token.len() >= 2 {
                set.insert(std::mem::take(&mut token));
            } else {
                token.clear();
            }
        } else {
            token.push(u);
        }
    }
    if token.len() >= 2 {
        set.insert(token);
    }

    if contains_japanese(cleaned) {
        for w in cleaned.windows(2) {
            set.insert(w.to_vec());
        }
    }

    set
}

/// Jaccard similarity J(A, B) = |A ∩ B| / |A ∪ B| with the TS edge cases
/// (src/utils/text/similarity.ts): both empty → 1.0 (identical emptiness —
/// two punctuation-only sentences dedupe against each other), exactly one
/// empty → 0.0.
pub fn jaccard_similarity(a: &WordSet, b: &WordSet) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let (small, large) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    let intersection = small.iter().filter(|w| large.contains(*w)).count() as f64;
    let union = a.len() as f64 + b.len() as f64 - intersection;
    intersection / union
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16_of(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn set_of(s: &str) -> WordSet {
        to_word_set(&u16_of(s))
    }

    #[test]
    fn english_tokens_from_lowercased_text() {
        let set = set_of("The quick brown fox.");
        assert!(set.contains(&u16_of("the")));
        assert!(set.contains(&u16_of("quick")));
        assert!(set.contains(&u16_of("fox"))); // trailing "." stripped by the $-regex
        assert!(!set.contains(&u16_of("fox.")));
        assert!(!set.contains(&u16_of("a"))); // 1-char token filtered
    }

    #[test]
    fn trailing_delimiter_stripped_once() {
        // "。。" loses only the LAST "。" — the first remains part of the text.
        let set = set_of("猫です。。");
        assert!(set.contains(&u16_of("猫です"))); // word token from lowered
        assert!(set.contains(&u16_of("す。"))); // bigram spans the kept "。"
        assert!(!set.contains(&u16_of("。。")));
    }

    #[test]
    fn japanese_bigrams_keep_original_case() {
        // getBigrams(cleaned) runs on the ORIGINAL-case text, so a Latin
        // uppercase letter inside Japanese-context text stays uppercase in
        // the bigram (tokenizer.ts parity — unlike the textrank variant).
        let set = set_of("これはAbcです");
        assert!(set.contains(&u16_of("Ab")));
        assert!(!set.contains(&u16_of("ab")));
        // Word tokens still come from the lowercased text — with no
        // separators present, the one token is the entire lowered text.
        assert!(set.contains(&u16_of("これはabcです")));
    }

    #[test]
    fn bigrams_include_separators() {
        // Bigrams span the WHOLE cleaned text, separators included.
        let set = set_of("一、二");
        assert!(set.contains(&u16_of("一、")));
        assert!(set.contains(&u16_of("、二")));
        // 一/二 are 1 UTF-16 unit each → filtered from word tokens.
        assert!(!set.contains(&u16_of("一")));
    }

    #[test]
    fn one_char_tokens_filtered_two_unit_astral_passes() {
        // "日" alone: 1 token of length 1 → filtered; bigrams need Japanese.
        assert!(set_of("日").is_empty());
        // A single emoji is 2 UTF-16 units → passes the length filter.
        assert_eq!(set_of("\u{1F600}").len(), 1);
    }

    #[test]
    fn punctuation_only_sentences_yield_empty_sets() {
        assert!(set_of("!").is_empty());
        assert!(set_of("？").is_empty());
    }

    #[test]
    fn jaccard_edges() {
        let empty: WordSet = HashSet::with_hasher(FxBuildHasher);
        assert_eq!(jaccard_similarity(&empty, &empty), 1.0);
        let a = set_of("alpha beta");
        assert_eq!(jaccard_similarity(&empty, &a), 0.0);
        let b = set_of("alpha beta");
        assert_eq!(jaccard_similarity(&a, &b), 1.0);
    }

    #[test]
    fn jaccard_value() {
        let a = set_of("alpha beta gamma");
        let b = set_of("alpha beta delta");
        // |∩| = 2 ("alpha","beta"), |∪| = 4 → 0.5
        assert_eq!(jaccard_similarity(&a, &b), 0.5);
    }
}
