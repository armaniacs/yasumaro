//! Word-set tokenization and Jaccard similarity, mirroring the TS reference:
//! the local `toWordSet` in `src/utils/sentenceExtractor.ts` (which, unlike
//! `src/utils/text/tokenizer.ts`'s variant, does NOT strip trailing sentence
//! punctuation — see that module's doc for why unifying them would silently
//! shift which sentences TextRank picks) plus `src/utils/text/similarity.ts`.

use std::collections::HashSet;

use crate::jsstring::{
    contains_japanese, is_word_separator, to_lowercase_utf16,
};

pub type WordSet = HashSet<Vec<u16>>;

/// Tokenizes `units` (UTF-16) into the word set used for Jaccard similarity:
/// lowercase the whole text first, split on the separator class, keep tokens
/// whose UTF-16 length is >= 2 (so a single astral character passes, exactly
/// like JS `.length`), then add character bigrams of the whole lowercased
/// text when it contains Japanese (order is irrelevant — this is a set).
pub fn to_word_set(units: &[u16]) -> WordSet {
    let cleaned = to_lowercase_utf16(units);
    let mut set: WordSet = HashSet::new();

    let mut token: Vec<u16> = Vec::new();
    for &u in &cleaned {
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

    if contains_japanese(&cleaned) {
        for w in cleaned.windows(2) {
            set.insert(w.to_vec());
        }
    }

    set
}

/// Jaccard similarity J(A, B) = |A ∩ B| / |A ∪ B| with the TS edge cases:
/// both empty → 1.0 (identical emptiness), exactly one empty → 0.0.
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
    use crate::jsstring::js_trim;

    fn u16_of(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn set_of(s: &str) -> WordSet {
        to_word_set(&u16_of(s))
    }

    #[test]
    fn english_tokens() {
        let set = set_of("The quick brown fox.");
        assert!(set.contains(&u16_of("the")));
        assert!(set.contains(&u16_of("quick")));
        assert!(set.contains(&u16_of("fox"))); // "fox." → separator splits; token "fox"
        assert!(!set.contains(&u16_of("fox.")));
        assert!(!set.contains(&u16_of("a"))); // 1-char token filtered
    }

    #[test]
    fn japanese_adds_bigrams_including_separator_spanning_ones() {
        let set = set_of("猫です。");
        // Word token: 猫です (3 units, no separators inside).
        assert!(set.contains(&u16_of("猫です")));
        // Bigrams are taken over the WHOLE lowercased text, separators included.
        assert!(set.contains(&u16_of("猫で")));
        assert!(set.contains(&u16_of("です")));
        assert!(set.contains(&u16_of("す。")));
        assert_eq!(set.len(), 4);
    }

    #[test]
    fn one_char_tokens_filtered_two_unit_astral_passes() {
        // "日" alone: 1 token of length 1 → filtered; bigrams: needs 2 units.
        let set = set_of("日");
        assert!(set.is_empty());
        // A single emoji is 2 UTF-16 units → passes the length filter (JS parity).
        let set = set_of("\u{1F600}");
        assert_eq!(set.len(), 1);
    }

    #[test]
    fn jaccard_edges() {
        let empty: WordSet = HashSet::new();
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

    #[test]
    fn tokenization_ignores_full_width_punctuation() {
        let set = set_of("一、二、三");
        // Words 一/二/三 are 1 UTF-16 unit each → filtered by the >=2 rule.
        assert!(!set.contains(&u16_of("一")));
        // Bigrams span the whole lowercased text's code units: 一、 、二 二、 、三.
        assert!(set.contains(&u16_of("一、")));
        assert!(set.contains(&u16_of("、二")));
        assert!(set.contains(&u16_of("二、")));
        assert!(set.contains(&u16_of("、三")));
        assert_eq!(set.len(), 4);
        // js_trim sanity used by callers:
        assert_eq!(js_trim(&u16_of(" x ")), u16_of("x"));
    }
}
