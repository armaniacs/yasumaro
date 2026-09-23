//! Word-set tokenization and Jaccard similarity, shared by the textrank
//! and sentence-dedup WASM cores.
//!
//! The two TS references differ on purpose in exactly two places, and ONLY
//! those two differences are parameters on the seam (`TokenizeOptions`):
//! - the local `toWordSet` in `src/utils/sentenceExtractor.ts` (textrank)
//!   does NOT strip trailing sentence punctuation, while `toWordSet` in
//!   `src/utils/text/tokenizer.ts` (dedup) strips ONE trailing sentence
//!   delimiter first (`sentence.replace(/[。！？.!?]$/, '')`) — unifying them
//!   would silently shift which sentences TextRank picks;
//! - textrank takes character bigrams over the LOWERCASED text, dedup takes
//!   them over the ORIGINAL-case cleaned text (`getBigrams(cleaned)`, not
//!   `getBigrams(cleaned.toLowerCase())`).
//!
//! Hasher policy (single decision point for all consumers): word sets use
//! FxHash. The default SipHash RandomState re-seeds every per-sentence set
//! and hashes `Vec<u16>` keys byte-wise, which dominates the O(n^2) pair
//! scans. Only the hasher differs from a default `HashSet` — membership
//! semantics (and thus Jaccard values) are identical to the TS
//! `Set<string>` reference either way: `jaccard_similarity` uses only
//! `len`/`contains`/counts, and neither core iterates a set in an
//! output-affecting order (textrank's PageRank sums over adjacency `Vec`s,
//! dedup scans `kept` linearly). Switching textrank from its previous std
//! hasher to FxHash therefore cannot change any output; it only removes
//! per-set re-seeding nondeterminism.
//!
//! `contains_japanese` placement note: textrank checked the lowercased text,
//! dedup the original-case text. The Japanese ranges (U+3040–U+309F,
//! U+30A0–U+30FF, U+4E00–U+9FFF) contain no cased characters, so no
//! lowercase mapping can move a unit into or out of them — both checks agree
//! on every input, and the single check below on the bigram source preserves
//! both behaviors.

use std::collections::HashSet;

use rustc_hash::FxBuildHasher;

use crate::jsstring::{
    contains_japanese, is_sentence_delimiter, is_word_separator, to_lowercase_utf16,
};

/// Word-set keyed by the raw UTF-16 token, hashed with FxHash. Only the
/// hasher differs from a default HashSet — membership semantics (and thus
/// Jaccard values) are identical to the TS `Set<string>` reference.
pub type WordSet = HashSet<Vec<u16>, FxBuildHasher>;

/// Which text the character bigrams come from when the cleaned text contains
/// Japanese (order is irrelevant — the set owns membership, not sequence).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BigramSource {
    /// `sentenceExtractor.ts` variant: bigrams of the lowercased text.
    Lowered,
    /// `tokenizer.ts` variant: bigrams of the original-case cleaned text
    /// (`getBigrams(cleaned)` — case preservation is deliberate JS parity).
    Original,
}

/// The two intentional tokenizer differences as parameters. Everything else
/// (separator class, `>= 2` UTF-16 length filter, bigram window, Jaccard
/// edge cases) is one shared implementation below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenizeOptions {
    /// Mirror of `sentence.replace(/[。！？.!?]$/, '')`: strip ONE trailing
    /// sentence delimiter ("。。") loses only the last "。").
    pub strip_trailing_delimiter: bool,
    /// Source text for the Japanese-context character bigrams.
    pub bigram_source: BigramSource,
}

/// textrank's parameterization: no strip, bigrams from the lowered text.
pub const TEXTRANK_TOKENIZE: TokenizeOptions = TokenizeOptions {
    strip_trailing_delimiter: false,
    bigram_source: BigramSource::Lowered,
};

/// sentence-dedup's parameterization: strip one trailing delimiter, bigrams
/// from the original-case cleaned text.
pub const DEDUP_TOKENIZE: TokenizeOptions = TokenizeOptions {
    strip_trailing_delimiter: true,
    bigram_source: BigramSource::Original,
};

/// Strips ONE trailing sentence delimiter — mirrors
/// `sentence.replace(/[。！？.!?]$/, '')` (single `$`-anchored match; "。。"
/// loses only the last "。").
pub fn strip_trailing_delimiter(units: &[u16]) -> &[u16] {
    match units.last() {
        Some(&u) if is_sentence_delimiter(u) => &units[..units.len() - 1],
        _ => units,
    }
}

/// Tokenizes `units` (UTF-16) into the word set used for Jaccard similarity:
/// optionally strip one trailing sentence delimiter, lowercase the whole
/// text, split on the separator class, keep tokens whose UTF-16 length is
/// >= 2 (so a single astral character passes, exactly like JS `.length`),
/// then add character bigrams of the whole bigram-source text (separators
/// included) when it contains Japanese.
pub fn to_word_set(units: &[u16], opts: TokenizeOptions) -> WordSet {
    let cleaned = if opts.strip_trailing_delimiter {
        strip_trailing_delimiter(units)
    } else {
        units
    };
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

    let bigrams: &[u16] = match opts.bigram_source {
        BigramSource::Lowered => &lowered,
        BigramSource::Original => cleaned,
    };
    if contains_japanese(bigrams) {
        for w in bigrams.windows(2) {
            set.insert(w.to_vec());
        }
    }

    set
}

/// Jaccard similarity J(A, B) = |A ∩ B| / |A ∪ B| with the TS edge cases
/// (`src/utils/text/similarity.ts`): both empty → 1.0 (identical emptiness),
/// exactly one empty → 0.0.
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

    fn set_of_with(s: &str, opts: TokenizeOptions) -> WordSet {
        to_word_set(&u16_of(s), opts)
    }

    #[test]
    fn english_tokens_both_variants() {
        // "." is a separator either way, so both options agree here.
        for opts in [TEXTRANK_TOKENIZE, DEDUP_TOKENIZE] {
            let set = set_of_with("The quick brown fox.", opts);
            assert!(set.contains(&u16_of("the")));
            assert!(set.contains(&u16_of("quick")));
            assert!(set.contains(&u16_of("fox")));
            assert!(!set.contains(&u16_of("fox.")));
            assert!(!set.contains(&u16_of("a"))); // 1-char token filtered
        }
    }

    #[test]
    fn trailing_delimiter_stripped_only_for_dedup() {
        // "猫です。。": dedup strips ONE trailing "。" — the first remains
        // part of the text (bigram "す。" present, "。。" absent).
        let set = set_of_with("猫です。。", DEDUP_TOKENIZE);
        assert!(set.contains(&u16_of("猫です"))); // word token from lowered
        assert!(set.contains(&u16_of("す。"))); // bigram spans the kept "。"
        assert!(!set.contains(&u16_of("。。")));
        // textrank keeps both delimiters: "。" still splits the word token,
        // and the delimiter pair itself appears as a bigram.
        let set = set_of_with("猫です。。", TEXTRANK_TOKENIZE);
        assert!(set.contains(&u16_of("猫です")));
        assert!(set.contains(&u16_of("。。")));
        assert_eq!(set.len(), 5);
    }

    #[test]
    fn textrank_bigrams_come_from_lowered_text() {
        // Lowered source: the uppercase Latin inside Japanese-context text
        // is lowercased in the bigram (sentenceExtractor.ts parity).
        let set = set_of_with("これはAbcです", TEXTRANK_TOKENIZE);
        assert!(set.contains(&u16_of("ab")));
        assert!(!set.contains(&u16_of("Ab")));
    }

    #[test]
    fn dedup_bigrams_keep_original_case() {
        // getBigrams(cleaned) runs on the ORIGINAL-case text, so a Latin
        // uppercase letter inside Japanese-context text stays uppercase in
        // the bigram (tokenizer.ts parity — unlike the textrank variant).
        let set = set_of_with("これはAbcです", DEDUP_TOKENIZE);
        assert!(set.contains(&u16_of("Ab")));
        assert!(!set.contains(&u16_of("ab")));
        // Word tokens still come from the lowercased text — with no
        // separators present, the one token is the entire lowered text.
        assert!(set.contains(&u16_of("これはabcです")));
    }

    #[test]
    fn textrank_japanese_bigrams_include_separator_spanning_ones() {
        let set = set_of_with("猫です。", TEXTRANK_TOKENIZE);
        // Word token: 猫です (3 units, no separators inside).
        assert!(set.contains(&u16_of("猫です")));
        // Bigrams are taken over the WHOLE lowercased text, separators included.
        assert!(set.contains(&u16_of("猫で")));
        assert!(set.contains(&u16_of("です")));
        assert!(set.contains(&u16_of("す。")));
        assert_eq!(set.len(), 4);
    }

    #[test]
    fn dedup_bigrams_include_separators() {
        // Bigrams span the WHOLE cleaned text, separators included.
        let set = set_of_with("一、二", DEDUP_TOKENIZE);
        assert!(set.contains(&u16_of("一、")));
        assert!(set.contains(&u16_of("、二")));
        // 一/二 are 1 UTF-16 unit each → filtered from word tokens.
        assert!(!set.contains(&u16_of("一")));
    }

    #[test]
    fn textrank_full_width_punctuation_bigrams() {
        let set = set_of_with("一、二、三", TEXTRANK_TOKENIZE);
        // Words 一/二/三 are 1 UTF-16 unit each → filtered by the >=2 rule.
        assert!(!set.contains(&u16_of("一")));
        // Bigrams span the whole lowercased text's code units: 一、 、二 二、 、三.
        assert!(set.contains(&u16_of("一、")));
        assert!(set.contains(&u16_of("、二")));
        assert!(set.contains(&u16_of("二、")));
        assert!(set.contains(&u16_of("、三")));
        assert_eq!(set.len(), 4);
    }

    #[test]
    fn one_char_tokens_filtered_two_unit_astral_passes() {
        for opts in [TEXTRANK_TOKENIZE, DEDUP_TOKENIZE] {
            // "日" alone: 1 token of length 1 → filtered; bigrams need Japanese-spanning pairs.
            assert!(set_of_with("日", opts).is_empty());
            // A single emoji is 2 UTF-16 units → passes the length filter (JS parity).
            assert_eq!(set_of_with("😀", opts).len(), 1);
        }
    }

    #[test]
    fn dedup_punctuation_only_sentences_yield_empty_sets() {
        assert!(set_of_with("!", DEDUP_TOKENIZE).is_empty());
        assert!(set_of_with("？", DEDUP_TOKENIZE).is_empty());
    }

    #[test]
    fn jaccard_edges() {
        let empty: WordSet = HashSet::with_hasher(FxBuildHasher);
        assert_eq!(jaccard_similarity(&empty, &empty), 1.0);
        let a = set_of_with("alpha beta", DEDUP_TOKENIZE);
        assert_eq!(jaccard_similarity(&empty, &a), 0.0);
        let b = set_of_with("alpha beta", DEDUP_TOKENIZE);
        assert_eq!(jaccard_similarity(&a, &b), 1.0);
    }

    #[test]
    fn jaccard_value() {
        let a = set_of_with("alpha beta gamma", TEXTRANK_TOKENIZE);
        let b = set_of_with("alpha beta delta", TEXTRANK_TOKENIZE);
        // |∩| = 2 ("alpha","beta"), |∪| = 4 → 0.5
        assert_eq!(jaccard_similarity(&a, &b), 0.5);
    }
}
