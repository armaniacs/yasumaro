//! JavaScript string semantics over UTF-16 code units.
//!
//! The TS reference implementations (`splitSentences`, `toWordSet` in
//! `src/utils/text/tokenizer.ts` and the local `toWordSet` in
//! `src/utils/sentenceExtractor.ts`) operate on JS strings, whose length
//! and indexing are UTF-16 code unit based. Rust `char`s are Unicode scalar
//! values, so a direct port would diverge wherever astral-plane characters
//! (emoji, rare kanji) appear: JS `.length` counts a surrogate pair as 2,
//! and `getBigrams` pairs raw code units — a lone low surrogate can even
//! become a token. To stay byte-identical with the TS output, this module
//! mirrors JS semantics by working on `&[u16]` slices throughout.
//!
//! Lone-surrogate caveat: wasm-bindgen converts JS strings to Rust `&str`
//! via UTF-8, which replaces lone surrogates with U+FFFD. Inputs containing
//! lone surrogates (essentially never produced by real page text) can
//! therefore diverge from the JS path; the hybrid wrapper falls back to the
//! TS implementation on any WASM error, so divergence only matters for
//! silent wrong output, not for crashes.

/// JS `\s` (WhiteSpace ∪ LineTerminator) as used by regex engines and
/// `String.prototype.trim()`: U+0009–U+000D, U+0020, U+00A0, U+1680,
/// U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
pub fn is_js_ws(u: u16) -> bool {
    matches!(u,
        0x0009..=0x000D
        | 0x0020
        | 0x00A0
        | 0x1680
        | 0x2000..=0x200A
        | 0x2028
        | 0x2029
        | 0x202F
        | 0x205F
        | 0x3000
        | 0xFEFF
    )
}

/// The word-separator class from the TS reference:
/// `/[\s　、。，．！？、。，．！？,.!?\-_:;()\[\]{}""''「」]+/`
/// (the doubled entries are literal duplicates in the source; the effective
/// set is the union below — straight ASCII quotes, not curly quotes).
pub fn is_word_separator(u: u16) -> bool {
    is_js_ws(u)
        || matches!(u,
            0x3001 | 0x3002          // 、 。
            | 0xFF0C | 0xFF0E        // ， ．
            | 0xFF01 | 0xFF1F        // ！ ？
            | 0x002C | 0x002E        // , .
            | 0x0021 | 0x003F        // ! ?
            | 0x002D | 0x005F        // - _
            | 0x003A | 0x003B        // : ;
            | 0x0028 | 0x0029        // ( )
            | 0x005B | 0x005D        // [ ]
            | 0x007B | 0x007D        // { }
            | 0x0022 | 0x0027        // " '
            | 0x300C | 0x300D        // 「 」
        )
}

/// Sentence delimiters from the TS reference regex `/([。！？.!?])\s*/g`.
fn is_sentence_delimiter(u: u16) -> bool {
    matches!(u, 0x3002 | 0xFF01 | 0xFF1F | 0x002E | 0x0021 | 0x003F)
}

/// `String.prototype.trim()` over UTF-16 units (trims exactly JS `\s`).
pub fn js_trim(units: &[u16]) -> &[u16] {
    let start = units.iter().position(|&u| !is_js_ws(u)).unwrap_or(units.len());
    let end = units
        .iter()
        .rposition(|&u| !is_js_ws(u))
        .map_or(start, |p| p + 1);
    &units[start..end.max(start)]
}

/// Start/end (into `units`) of the JS-trimmed content within
/// `units[start..end]`, or `None` when the slice is all whitespace.
fn trimmed_range(units: &[u16], start: usize, end: usize) -> Option<(usize, usize)> {
    let slice = &units[start..end];
    let lead = slice.iter().position(|&u| !is_js_ws(u))?;
    let trail = slice.iter().rposition(|&u| !is_js_ws(u))?;
    Some((start + lead, start + trail + 1))
}

/// Ranges (into `units`) of sentences, mirroring the TS `splitSentences`:
/// a sentence is the trimmed text from the loop's `lastIndex` up to and
/// including the delimiter. Two distinct JS positions must not be conflated:
/// the regex object's scan position advances past the consumed `\s*`, but
/// the loop's `lastIndex` is `match.index + 1` — right after the delimiter
/// (sentenceExtractor.ts:31). Setting `last` past the whitespace instead
/// diverges whenever two delimiters are separated by whitespace alone
/// (TS `splitSentences(". .")` is `["."]`, not `[]`).
/// The `match.index > lastIndex` guard (skipping empty segments between
/// adjacent delimiters, e.g. `"a..b"`) is preserved via `i > last`.
pub fn split_sentence_ranges(units: &[u16]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut last = 0usize;
    let mut i = 0usize;
    while i < units.len() {
        if !is_sentence_delimiter(units[i]) {
            i += 1;
            continue;
        }
        if i > last {
            if let Some(range) = trimmed_range(units, last, i + 1) {
                ranges.push(range);
            }
        }
        // Scan position skips the regex-consumed `\s*`; the loop's `last`
        // stays right after the delimiter, exactly like the TS loop variable.
        let mut j = i + 1;
        while j < units.len() && is_js_ws(units[j]) {
            j += 1;
        }
        last = i + 1;
        i = j;
    }
    if last < units.len() {
        if let Some(range) = trimmed_range(units, last, units.len()) {
            ranges.push(range);
        }
    }
    ranges
}

/// Whether `cleaned` (a lowercased string) contains Japanese characters —
/// mirrors `/[぀-ゟ゠-ヿ一-鿿]/` (U+3040–U+309F, U+30A0–U+30FF, U+4E00–U+9FFF).
pub fn contains_japanese(units: &[u16]) -> bool {
    units.iter().any(|&u| {
        (0x3040..=0x309F).contains(&u)
            || (0x30A0..=0x30FF).contains(&u)
            || (0x4E00..=0x9FFF).contains(&u)
    })
}

/// JS `String.prototype.toLowerCase()` over UTF-16 units: full Unicode case
/// mapping applied per scalar value (a surrogate pair is decoded, lowercased,
/// and re-encoded — its lowercase form is the pair again in practice).
pub fn to_lowercase_utf16(units: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(units.len());
    let mut i = 0usize;
    while i < units.len() {
        let u = units[i];
        let ch = if (0xD800..=0xDBFF).contains(&u)
            && i + 1 < units.len()
            && (0xDC00..=0xDFFF).contains(&units[i + 1])
        {
            let code = 0x10000 + (((u as u32 - 0xD800) << 10) | (units[i + 1] as u32 - 0xDC00));
            i += 1;
            char::from_u32(code).unwrap_or('\u{FFFD}')
        } else {
            char::from_u32(u as u32).unwrap_or('\u{FFFD}')
        };
        for lc in ch.to_lowercase() {
            let mut buf = [0u16; 2];
            out.extend_from_slice(lc.encode_utf16(&mut buf));
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16_of(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn text_of(ranges: &[(usize, usize)], units: &[u16]) -> Vec<String> {
        ranges
            .iter()
            .map(|(s, e)| String::from_utf16_lossy(&units[*s..*e]))
            .collect()
    }

    #[test]
    fn trim_matches_js() {
        assert_eq!(js_trim(&u16_of("\u{3000}x y\u{00A0}")), u16_of("x y"));
        assert!(js_trim(&u16_of("  \u{FEFF}")).is_empty());
    }

    #[test]
    fn split_sentences_basic() {
        let units = u16_of("First. Second! Third?");
        let ranges = split_sentence_ranges(&units);
        assert_eq!(text_of(&ranges, &units), vec!["First.", "Second!", "Third?"]);
    }

    #[test]
    fn split_sentences_japanese() {
        let units = u16_of("これは一文です。これは二文です！三文目？");
        let ranges = split_sentence_ranges(&units);
        assert_eq!(
            text_of(&ranges, &units),
            vec!["これは一文です。", "これは二文です！", "三文目？"]
        );
    }

    #[test]
    fn split_sentences_adjacent_delimiters_skip_empty_segment() {
        // "a..b": the second "." starts at lastIndex, so no empty sentence
        // is emitted for it — matches the `match.index > lastIndex` guard.
        let units = u16_of("a..b");
        let ranges = split_sentence_ranges(&units);
        assert_eq!(text_of(&ranges, &units), vec!["a.", "b"]);
    }

    #[test]
    fn split_sentences_leading_delimiter() {
        // The leading "." matches at index 0 which is not > lastIndex(0),
        // so no empty sentence is emitted; "hi." comes from the 2nd match.
        let units = u16_of(".hi.");
        let ranges = split_sentence_ranges(&units);
        assert_eq!(text_of(&ranges, &units), vec!["hi."]);
    }

    #[test]
    fn split_sentences_trailing_whitespace_consumed() {
        // The \s* after the delimiter is consumed and NOT re-emitted.
        let units = u16_of("One.   \nTwo.");
        let ranges = split_sentence_ranges(&units);
        assert_eq!(text_of(&ranges, &units), vec!["One.", "Two."]);
    }

    #[test]
    fn split_sentences_whitespace_separated_delimiters_match_ts() {
        // Regression for the lastIndex divergence: the TS loop variable is
        // match.index + 1 (NOT past the consumed \s*), so a lone "."
        // delimited only by whitespace still becomes its own sentence.
        for (input, expected) in [
            (". .", vec!["."]),
            ("a. .b", vec!["a.", ".", "b"]),
            ("! ?", vec!["?"]),
            ("x! ?y", vec!["x!", "?", "y"]),
        ] {
            let units = u16_of(input);
            let ranges = split_sentence_ranges(&units);
            assert_eq!(text_of(&ranges, &units), expected, "input: {input}");
        }
    }

    #[test]
    fn lowercase_handles_astral_pairs() {
        // U+1F600 (emoji, surrogate pair) survives lowercasing unchanged;
        // its UTF-16 length stays 2.
        let emoji = "\u{1F600}";
        let lowered = to_lowercase_utf16(&u16_of(emoji));
        assert_eq!(lowered.len(), 2);
        assert_eq!(String::from_utf16_lossy(&lowered), emoji);
        assert_eq!(to_lowercase_utf16(&u16_of("ABCİ")), u16_of("abc\u{0069}\u{0307}"));
    }

    #[test]
    fn japanese_detection_ranges() {
        assert!(contains_japanese(&u16_of("ひらがな")));
        assert!(contains_japanese(&u16_of("カタカナ")));
        assert!(contains_japanese(&u16_of("漢字")));
        assert!(!contains_japanese(&u16_of("English only")));
        assert!(!contains_japanese(&u16_of("")));
    }
}
