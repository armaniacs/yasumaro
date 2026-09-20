//! JavaScript string semantics over UTF-16 code units (dedup variant).
//!
//! Adapted from `wasm/textrank/src/jsstring.rs` — the TS reference here is
//! the local `splitSentences` in `src/utils/contentDeduplicator.ts` plus
//! `src/utils/text/tokenizer.ts`, which operate on JS strings whose length
//! and indexing are UTF-16 code unit based. Rust `char`s are Unicode scalar
//! values, so a direct port would diverge wherever astral-plane characters
//! appear: JS `.length` counts a surrogate pair as 2, and `getBigrams`
//! pairs raw code units. To stay byte-identical with the TS output, this
//! module mirrors JS semantics by working on `&[u16]` slices throughout.
//!
//! Split-variant difference (why this is not textrank's
//! `split_sentence_ranges`): contentDeduplicator's local `splitSentences`
//! does NOT trim sentences and keeps the delimiter attached to the sentence,
//! with the consumed `\s*` stored as a separate `delimiter` — the original
//! text must be reconstructable after dedup removes sentences
//! (`kept.map(k => k.sentence + k.delimiter).join('')`).
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

/// The word-separator class from the TS reference (`src/utils/text/tokenizer.ts`):
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
pub fn is_sentence_delimiter(u: u16) -> bool {
    matches!(u, 0x3002 | 0xFF01 | 0xFF1F | 0x002E | 0x0021 | 0x003F)
}

/// Whether `cleaned` (a sentence, pre-lowercase) contains Japanese characters
/// — mirrors `/[぀-ゟ゠-ヿ一-鿿]/` (U+3040–U+309F, U+30A0–U+30FF, U+4E00–U+9FFF).
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

/// One segment produced by the dedup-variant split: `sentence` is the raw
/// (untrimmed) slice INCLUDING its trailing delimiter character, `delimiter`
/// is the `\s*` the regex consumed right after that delimiter (possibly
/// empty). Ranges are half-open indices into the full input unit slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SentencePart {
    pub sentence: (usize, usize),
    pub delimiter: (usize, usize),
}

/// Ranges of sentence parts, mirroring the local `splitSentences` in
/// `src/utils/contentDeduplicator.ts` exactly:
///
/// ```js
/// const regex = /([。！？.!?])\s*/g;
/// let lastIndex = 0;
/// while ((match = regex.exec(text)) !== null) {
///   if (match.index > lastIndex) {
///     result.push({ sentence: text.slice(lastIndex, match.index + match[1].length),
///                   delimiter: match[0].slice(match[1].length) });
///   }
///   lastIndex = match.index + match[1].length;
/// }
/// if (lastIndex < text.length) result.push({ sentence: text.slice(lastIndex), delimiter: '' });
/// ```
///
/// Two distinct JS positions must not be conflated: the regex object's scan
/// position advances past the consumed `\s*`, but the loop's `lastIndex` is
/// `match.index + 1` — right after the delimiter. The whitespace a match
/// consumed therefore appears BOTH as the current part's `delimiter` AND at
/// the start of the next sentence (or the tail) — a deliberate quirk of the
/// TS reference that this port reproduces so reconstruction stays
/// byte-identical.
pub fn split_sentence_parts(units: &[u16]) -> Vec<SentencePart> {
    let mut parts = Vec::new();
    let mut last = 0usize; // loop's lastIndex: right after the previous delimiter
    let mut i = 0usize; // regex scan position: past the consumed \s*
    while i < units.len() {
        if !is_sentence_delimiter(units[i]) {
            i += 1;
            continue;
        }
        if i > last {
            let mut j = i + 1;
            while j < units.len() && is_js_ws(units[j]) {
                j += 1;
            }
            parts.push(SentencePart {
                sentence: (last, i + 1),
                delimiter: (i + 1, j),
            });
        }
        let mut j = i + 1;
        while j < units.len() && is_js_ws(units[j]) {
            j += 1;
        }
        last = i + 1;
        i = j;
    }
    if last < units.len() {
        parts.push(SentencePart {
            sentence: (last, units.len()),
            delimiter: (units.len(), units.len()),
        });
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u16_of(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    fn parts_of(s: &str) -> Vec<String> {
        let units = u16_of(s);
        split_sentence_parts(&units)
            .iter()
            .map(|p| {
                let mut t = String::from_utf16_lossy(&units[p.sentence.0..p.sentence.1]);
                t.push_str(&String::from_utf16_lossy(&units[p.delimiter.0..p.delimiter.1]));
                t
            })
            .collect()
    }

    #[test]
    fn split_keeps_delimiters_attached_and_untrimmed() {
        // The whitespace a match consumed is stored as the current part's
        // delimiter AND stays at the start of the next sentence (the loop's
        // lastIndex is right after the previous delimiter) — the TS
        // reference's exact quirk, verified against deduplicateContent:
        // "First. Second! Third? tail" reconstructs to
        // "First.  Second!  Third?  tail" (doubled spaces).
        let units = u16_of("First. Second! Third? tail");
        let parts = split_sentence_parts(&units);
        let texts: Vec<String> = parts
            .iter()
            .map(|p| String::from_utf16_lossy(&units[p.sentence.0..p.sentence.1]))
            .collect();
        assert_eq!(texts, vec!["First.", " Second!", " Third?", " tail"]);
        let delims: Vec<String> = parts
            .iter()
            .map(|p| String::from_utf16_lossy(&units[p.delimiter.0..p.delimiter.1]))
            .collect();
        assert_eq!(delims, vec![" ", " ", " ", ""]);
    }

    #[test]
    fn split_japanese() {
        assert_eq!(parts_of("これは一文です。これは二文です！三文目？"), vec![
            "これは一文です。", "これは二文です！", "三文目？"
        ]);
    }

    #[test]
    fn split_adjacent_delimiters_skip_empty_segment() {
        // "a..b": the second "." starts at lastIndex, so no empty sentence is
        // emitted for it — matches the `match.index > lastIndex` guard.
        assert_eq!(parts_of("a..b"), vec!["a.", "b"]);
    }

    #[test]
    fn split_whitespace_separated_delimiters() {
        // Verified against the TS reference via deduplicateContent outputs:
        // the loop's lastIndex is match.index + 1 (NOT past the consumed
        // \s*), so whitespace consumed by one match reappears at the start
        // of the following sentence.
        assert_eq!(parts_of(". ."), vec![" ."]);
        assert_eq!(parts_of("a. .b"), vec!["a. ", " .", "b"]);
        assert_eq!(parts_of("! ?"), vec![" ?"]);
        assert_eq!(parts_of("x! ?y"), vec!["x! ", " ?", "y"]);
    }

    #[test]
    fn split_tail_whitespace_duplicated_like_ts() {
        // The \s* after the last delimiter is consumed by the regex (and
        // stored as this part's delimiter), but the loop's lastIndex stays
        // before it — so the tail sentence repeats that whitespace. The TS
        // reference does exactly this; reconstruction must not "fix" it.
        assert_eq!(parts_of("a. "), vec!["a. ", " "]);
        assert_eq!(parts_of("a.   x"), vec!["a.   ", "   x"]);
    }

    #[test]
    fn split_leading_delimiter() {
        // The leading "." matches at index 0 which is not > lastIndex(0).
        assert_eq!(parts_of(".hi."), vec!["hi."]);
    }

    #[test]
    fn split_empty_and_no_delimiters() {
        let units = u16_of("");
        assert!(split_sentence_parts(&units).is_empty());
        // No delimiter anywhere: the whole text is one tail part.
        assert_eq!(parts_of("hello world"), vec!["hello world"]);
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
