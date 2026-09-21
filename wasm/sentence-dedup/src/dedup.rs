//! The sentence-level dedup algorithm, an exact port of
//! `deduplicateContent` in `src/utils/contentDeduplicator.ts`:
//!
//! ```js
//! for (const part of sentenceParts) {
//!   if (part.sentence.length < minLength) {
//!     kept.push(part); keptSets.push(toWordSet(part.sentence)); continue;
//!   }
//!   const wordSet = toWordSet(part.sentence);
//!   const isDuplicate = keptSets.some(s => jaccardSimilarity(wordSet, s) >= threshold);
//!   if (!isDuplicate) { kept.push(part); keptSets.push(wordSet); }
//! }
//! return kept.map(k => k.sentence + k.delimiter).join('');
//! ```
//!
//! Parity notes:
//! - Short sentences (below `minLength`) are ALWAYS kept, but their word
//!   sets still participate in later comparisons — a long sentence similar
//!   to a short one IS removed.
//! - The first part is always kept (nothing to compare against).
//! - `>= threshold` uses IEEE f64 comparison; JS numbers are f64, so both
//!   engines produce bit-identical similarity values for identical inputs.
//! - Negative thresholds are degenerate-but-defined in the TS reference
//!   (every sentence after the first matches `jaccard >= negative`) — the
//!   same falls out of this loop naturally; only NaN is rejected (see
//!   lib.rs — the TS comparison `>= NaN` is always false, i.e. keep
//!   everything, and the wrapper bypasses NaN to the TS path instead).
//! - Beyond `MAX_SENTENCES_FOR_DEDUP`, this core deliberately diverges from
//!   the uncapped TS reference (see `dedup_core`'s doc).

use js_strings::{
    jaccard_similarity, split_sentence_parts, to_word_set, WordSet, DEDUP_TOKENIZE,
};

/// Safety cap on the O(n^2) pair scan. The TS reference is uncapped, and
/// dedup runs BEFORE the extractor's `maxChars` truncation — a delimiter-
/// dense page can split into tens of thousands of parts, turning the pair
/// scan into a multi-second hang (the WASM path exists to bound exactly
/// this). Above the cap, fail OPEN: the first `MAX_SENTENCES_FOR_DEDUP`
/// parts dedupe pairwise, the tail is appended unconditionally. No content
/// is ever dropped; only redundancy reduction stops. This divergence from
/// the TS fallback is deliberate and documented in the hybrid wrapper.
pub const MAX_SENTENCES_FOR_DEDUP: usize = 1000;

/// Returns the kept part indices (in original order) and the total part
/// count the core's own split produced. The count lets the TS wrapper
/// verify its own split agrees before mapping indices back to strings —
/// an in-range index from a disagreeing split would otherwise silently
/// map to the wrong part.
pub fn dedup_core(units: &[u16], threshold: f64, min_length: u32) -> (Vec<u32>, usize) {
    let parts = split_sentence_parts(units);
    let count = parts.len();

    // TS: `if (threshold === 0) return text` — exact zero short-circuits
    // BEFORE any comparison (a loop with threshold 0 would remove every
    // part after the first, since jaccard >= 0 always holds). Keeping all
    // indices is exactly equivalent to returning the text unchanged.
    // (Negative zero is included: JS `-0 === 0`, and `-0.0 == 0.0` in Rust.)
    if threshold == 0.0 {
        return ((0..count as u32).collect(), count);
    }

    let mut kept_indices: Vec<u32> = Vec::new();
    let mut kept_sets: Vec<WordSet> = Vec::new();

    let pairwise_end = count.min(MAX_SENTENCES_FOR_DEDUP);
    for (idx, part) in parts[..pairwise_end].iter().enumerate() {
        let sentence = &units[part.sentence.0..part.sentence.1];
        let set = to_word_set(sentence, DEDUP_TOKENIZE);

        // TS: part.sentence.length < minLength (UTF-16 length, delimiter
        // included — the sentence slice carries the delimiter).
        if sentence.len() < min_length as usize {
            kept_indices.push(idx as u32);
            kept_sets.push(set);
            continue;
        }

        let is_duplicate = kept_sets.iter().any(|existing| {
            // Exact size-ratio prune: J = |∩|/|∪| ≤ min(|A|,|B|)/max(|A|,|B|)
            // because |∩| ≤ min and |∪| ≥ max. When the ratio is already
            // below the threshold, J cannot reach it — skip the token
            // iteration entirely. Applied only when both sets are non-empty
            // (the empty-set edge cases — J = 1.0 for two empty sets, 0.0
            // for exactly one — must still reach jaccard_similarity), and
            // skipped naturally for negative thresholds (ratio < negative
            // is never true). The pruning is semantics-preserving: it only
            // skips comparisons whose outcome is already determined.
            let (sa, sb) = (set.len(), existing.len());
            if sa > 0 && sb > 0 {
                let ratio = if sa <= sb {
                    sa as f64 / sb as f64
                } else {
                    sb as f64 / sa as f64
                };
                if ratio < threshold {
                    return false;
                }
            }
            jaccard_similarity(&set, existing) >= threshold
        });

        if !is_duplicate {
            kept_indices.push(idx as u32);
            kept_sets.push(set);
        }
    }

    // Fail-open tail: beyond the cap, keep everything without comparisons.
    if count > MAX_SENTENCES_FOR_DEDUP {
        kept_indices.extend((MAX_SENTENCES_FOR_DEDUP as u32)..(count as u32));
    }

    (kept_indices, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_sentences_removed_after_first() {
        let text = "alpha beta gamma. alpha beta gamma. delta epsilon zeta.";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.7, 10);
        assert_eq!(count, 3);
        assert_eq!(kept, vec![0, 2]);
    }

    #[test]
    fn japanese_bigram_similarity_dedupes() {
        // Same sentence repeated — bigrams (and the word token) match fully.
        let text = "これはテスト用の文章です。これはテスト用の文章です。別の内容を含む文です。";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.7, 10);
        assert_eq!(count, 3);
        assert_eq!(kept, vec![0, 2]);
    }

    #[test]
    fn short_sentences_always_kept_but_sets_participate() {
        // Verified against deduplicateContent("hi. hello world today. hello
        // world today again.", { threshold: 0.7, minLength: 10 }) →
        // "hi.  hello world today. " (tail removed, whitespace doubled).
        // "hi." (3 units) < minLength 10 → always kept, set {hi}.
        // " hello world today." (19 ≥ 10): J({hello,world,today},{hi}) = 0
        // → kept. " hello world today again." (24): J = 3/4 = 0.75 ≥ 0.7
        // vs part1's set → REMOVED.
        let text = "hi. hello world today. hello world today again.";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.7, 10);
        assert_eq!(count, 3);
        assert_eq!(kept, vec![0, 1]);

        // Same corpus at threshold 0.5 (verified: → "hi.  hello world
        // today. "): part2 removed at J = 1.0, part3 at J = 0.75.
        let text2 = "hi. hello world today. hello world today. hello world today again.";
        let units2: Vec<u16> = text2.encode_utf16().collect();
        let (kept2, count2) = dedup_core(&units2, 0.5, 10);
        assert_eq!(count2, 4);
        assert_eq!(kept2, vec![0, 1]);

        // The SHORT sentence's set removing a later LONG one (verified:
        // deduplicateContent("AB CD. AB CD EF GH IJ KL.", { threshold: 0.3,
        // minLength: 10 }) → "AB CD. "): {ab,cd} vs {ab,cd,ef,gh,ij,kl} →
        // J = 2/6 ≈ 0.333 ≥ 0.3 → the long sentence is removed even though
        // the short one skipped the comparison path itself.
        let text3 = "AB CD. AB CD EF GH IJ KL.";
        let units3: Vec<u16> = text3.encode_utf16().collect();
        let (kept3, count3) = dedup_core(&units3, 0.3, 10);
        assert_eq!(count3, 2);
        assert_eq!(kept3, vec![0]);
    }

    #[test]
    fn threshold_zero_keeps_everything() {
        let text = "same. same. same.";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.0, 10);
        assert_eq!(count, 3);
        assert_eq!(kept, vec![0, 1, 2]);
    }

    #[test]
    fn threshold_one_keeps_only_exact_duplicates_out() {
        let text = "alpha beta. alpha beta. alpha gamma.";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 1.0, 10);
        assert_eq!(count, 3);
        assert_eq!(kept, vec![0, 2]); // identical set removed at J = 1
    }

    #[test]
    fn punctuation_only_sentences_dedupe_via_empty_set_rule() {
        // Both word sets are EMPTY (every unit is a separator) →
        // jaccard(empty, empty) = 1.0 ≥ threshold → the second is removed.
        // "-" and "," are separators but NOT sentence delimiters, so each
        // run stays one part; "!" splits them.
        let text = "-----!,,,,,";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.7, 3);
        assert_eq!(count, 2);
        assert_eq!(kept, vec![0]);

        // Empty set vs non-empty set → J = 0.0 → both kept.
        let text2 = "-----!ab,";
        let units2: Vec<u16> = text2.encode_utf16().collect();
        let (kept2, count2) = dedup_core(&units2, 0.7, 3);
        assert_eq!(count2, 2);
        assert_eq!(kept2, vec![0, 1]);
    }

    #[test]
    fn empty_and_whitespace_inputs() {
        let (kept, count) = dedup_core(&[], 0.7, 10);
        assert_eq!(count, 0);
        assert!(kept.is_empty());
        let units: Vec<u16> = "   ".encode_utf16().collect();
        // Whitespace-only text: one tail part, always kept.
        let (kept, count) = dedup_core(&units, 0.7, 10);
        assert_eq!(count, 1);
        assert_eq!(kept, vec![0]);
    }

    #[test]
    fn negative_threshold_is_degenerate_but_defined_like_ts() {
        // jaccard >= negative is always true → everything after the first
        // part is removed. The TS reference behaves identically (no early
        // return for negatives — only exact 0 short-circuits).
        let text = "one two three. four five six.";
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, -0.5, 10);
        assert_eq!(count, 2);
        assert_eq!(kept, vec![0]);
    }

    #[test]
    fn cap_fails_open_beyond_max_sentences() {
        // 1100 pairwise-distinct sentences ("marker{i}" is a ≥2-unit token,
        // so every set differs; J between two ≈ 4/6 < 0.7): the head 1000
        // dedupe pairwise and all are kept, the tail is appended
        // unconditionally — no content dropped. The trailing space after
        // the last delimiter becomes one extra whitespace tail part (TS
        // split quirk), so count is 1101.
        let text: String = (0..1100)
            .map(|i| format!("sentence marker{i} unique words here. "))
            .collect();
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.7, 10);
        assert_eq!(count, 1101);
        assert_eq!(kept.len(), 1101);
        assert_eq!(&kept[..1000], &(0u32..1000).collect::<Vec<u32>>()[..]);
        assert_eq!(&kept[1000..], &(1000u32..1101).collect::<Vec<u32>>()[..]);
    }

    #[test]
    fn cap_head_still_dedupes_duplicates() {
        // Every sentence identical: within the head only the first survives
        // the pairwise scan; the tail is kept unconditionally (fail-open).
        // Plus the whitespace tail part → 1 + 101 = 102 kept.
        let text: String = "duplicate content repeated here. ".repeat(1100);
        let units: Vec<u16> = text.encode_utf16().collect();
        let (kept, count) = dedup_core(&units, 0.7, 10);
        assert_eq!(count, 1101);
        assert_eq!(kept.len(), 102);
        assert_eq!(kept[0], 0);
        assert_eq!(&kept[1..], &(1000u32..1101).collect::<Vec<u32>>()[..]);
    }
}
