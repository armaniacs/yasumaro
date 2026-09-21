//! Pure-Rust port of `sanitizeForObsidian` and its two helper stages in
//! `src/utils/markdownSanitizer.ts`.
//!
//! The TS reference applies three stages in a fixed (meaning-bearing) order:
//! 1. `sanitizeAllMarkdownLinks`: `(!?)\[([^\]]*)\]\(([^)]+)\)` with `gi`
//!    replaced by `$1\[$2\]\($3\)`.
//! 2. `escapeObsidianWikilinks`: `(!?)\[\[([^\]]*)\]\]` with `g` replaced by
//!    `$1\[\[$2\]\]` (a replacer function, same output shape).
//! 3. HTML entity encoding: `&` first, then `<`, then `>`.
//!
//! No `regex` crate is used on purpose. Both patterns are alternation-free:
//! `[^...]*`/`[^...]+` can only extend to the FIRST closing delimiter (any
//! shorter choice would force `\]`/`\)` to match a non-delimiter and fail),
//! so the greedy choice is forced and a byte scanner reproduces the JS
//! leftmost-match walk exactly — with zero regex-dialect risk and a smaller
//! binary. The `i` flag is a semantic no-op here (the patterns contain no
//! literal letters, verified by the STEP 1 probe: `[A](HTTPS://example.com)`
//! matches, and case plays no other role).
//!
//! Quirks reproduced (all pinned by `bench/md-sanitize-probe-result.json`):
//! - The URL class `[^)]+` stops at the FIRST `)`, so
//!   `[t](javascript:alert(1))` yields `\[t\]\(javascript:alert(1\))`
//!   (trailing `)` kept verbatim).
//! - Leftmost matching consumes outer brackets first:
//!   `[[[a](https://x)]]` yields `\[[[a\]\(https://x\)]]` (the link match
//!   starting at index 0 eats the wikilink's opening brackets).
//! - Entity encoding double-encodes (`&lt;` becomes `&amp;lt;`); the chain
//!   is not idempotent.
//! - `&` inside an escaped link URL is still entity-encoded
//!   (`[a](https://x/?a=1&b=2)` → `\[a\]\(https://x/?a=1&amp;b=2\)`)
//!   because entity encoding runs after link escaping.
//!
//! JS-semantics fidelity note: the TS implementation works on UTF-16 code
//! units. This core scans bytes but only treats ASCII delimiters specially,
//! so every valid Unicode scalar (including astral-plane characters, which
//! are surrogate pairs in JS) behaves identically. Lone surrogates cannot
//! survive the `&str` boundary and become U+FFFD (same caveat as the
//! textrank/sentence-dedup/tag-cooccur crates); they are excluded from the
//! parity corpus and documented in lib.rs.

/// Stage 1: escape every `[text](url)` / `![alt](url)` regardless of scheme.
///
/// Mirrors `sanitizeAllMarkdownLinks`: `(!?)\[([^\]]*)\]\(([^)]+)\)` →
/// `$1\[$2\]\($3\)`.
pub fn escape_all_markdown_links(input: &str) -> String {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < len {
        let mut j = i;
        let mut bang = false;
        if bytes[j] == b'!' {
            bang = true;
            j += 1;
        }
        let matched = if j < len && bytes[j] == b'[' {
            // `[^]]*` is forced to the first `]`: any shorter choice would
            // make `\]` match a non-`]` byte and fail.
            let mut k = j + 1;
            while k < len && bytes[k] != b']' {
                k += 1;
            }
            if k < len && k + 1 < len && bytes[k + 1] == b'(' {
                // `[^)]+` is forced to the first `)` and needs >= 1 char.
                let mut m = k + 2;
                while m < len && bytes[m] != b')' {
                    m += 1;
                }
                if m < len && m > k + 2 {
                    if bang {
                        out.push('!');
                    }
                    out.push_str("\\[");
                    out.push_str(&input[j + 1..k]);
                    out.push_str("\\]\\(");
                    out.push_str(&input[k + 2..m]);
                    out.push_str("\\)");
                    i = m + 1;
                    true
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        };
        if !matched {
            // No match at `i`: the JS engine advances one UTF-16 code unit;
            // advancing one Rust `char` copies the identical text.
            let ch = input[i..].chars().next().expect("char boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// Stage 2: escape `[[wikilink]]` / `![[embed]]`.
///
/// Mirrors `escapeObsidianWikilinks`: `(!?)\[\[([^\]]*)\]\]` → the replacer
/// returns `bang + "\[\[" + inner + "\]\]"`.
pub fn escape_obsidian_wikilinks(input: &str) -> String {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < len {
        let mut j = i;
        let mut bang = false;
        if bytes[j] == b'!' {
            bang = true;
            j += 1;
        }
        let matched = if j + 1 < len && bytes[j] == b'[' && bytes[j + 1] == b'[' {
            let mut k = j + 2;
            while k < len && bytes[k] != b']' {
                k += 1;
            }
            if k + 1 < len && bytes[k] == b']' && bytes[k + 1] == b']' {
                if bang {
                    out.push('!');
                }
                out.push_str("\\[\\[");
                out.push_str(&input[j + 2..k]);
                out.push_str("\\]\\]");
                i = k + 2;
                true
            } else {
                false
            }
        } else {
            false
        };
        if !matched {
            let ch = input[i..].chars().next().expect("char boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// Stage 3: HTML entity encoding with the meaning-bearing `&`-first order.
///
/// `&` must be encoded before `<`/`>` so the `;`-terminated `&lt;`/`&gt;`
/// entities introduced below are not themselves re-encoded.
pub fn encode_html_entities(input: &str) -> String {
    // `str::replace` scans left to right with no re-scan of inserted text,
    // exactly like the chained JS `.replace(/&/g, ...)` calls.
    input.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Full chain: link escaping → wikilink escaping → entity encoding.
///
/// Mirrors `sanitizeForObsidian`. The empty-string fast path falls out
/// naturally (the scanners emit nothing); non-string inputs cannot cross
/// the JS→WASM boundary and stay guarded on the wrapper side, matching the
/// TS `typeof` early return.
pub fn sanitize_for_obsidian(input: &str) -> String {
    encode_html_entities(&escape_obsidian_wikilinks(&escape_all_markdown_links(input)))
}

/// Batch entry point: sanitize every entry in one WASM call.
///
/// Used by the export path (e.g. 2000 summaries per Markdown export) so the
/// per-call marshalling cost is paid once, not per entry.
pub fn sanitize_batch(inputs: &[String]) -> Vec<String> {
    inputs.iter().map(|s| sanitize_for_obsidian(s)).collect()
}

/// Batch + join entry point: sanitize every entry and join with `separator`
/// inside WASM, so the export aggregation crosses the boundary as a single
/// string (mirrors `entries.map(...).join('\n---\n')` in exportLogsService).
pub fn sanitize_batch_and_join(inputs: &[String], separator: &str) -> String {
    inputs
        .iter()
        .map(|s| sanitize_for_obsidian(s))
        .collect::<Vec<_>>()
        .join(separator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_stays_empty() {
        assert_eq!(sanitize_for_obsidian(""), "");
        assert_eq!(escape_all_markdown_links(""), "");
        assert_eq!(escape_obsidian_wikilinks(""), "");
        assert_eq!(encode_html_entities(""), "");
    }

    #[test]
    fn plain_text_passthrough() {
        assert_eq!(sanitize_for_obsidian("hello world"), "hello world");
        assert_eq!(sanitize_for_obsidian("[just brackets]"), "[just brackets]");
    }

    #[test]
    fn link_stage_escapes_regardless_of_scheme() {
        assert_eq!(
            escape_all_markdown_links("[evil](https://malicious.com)"),
            "\\[evil\\]\\(https://malicious.com\\)"
        );
        assert_eq!(
            escape_all_markdown_links("[A](HTTPS://example.com)"),
            "\\[A\\]\\(HTTPS://example.com\\)"
        );
        assert_eq!(
            escape_all_markdown_links("![alt](https://x/y.png)"),
            "!\\[alt\\]\\(https://x/y.png\\)"
        );
        assert_eq!(escape_all_markdown_links("[](https://x.com)"), "\\[\\]\\(https://x.com\\)");
    }

    #[test]
    fn url_stops_at_first_close_paren() {
        // `[^)]+` cannot cross `)`: the trailing paren survives verbatim.
        assert_eq!(
            escape_all_markdown_links("[t](javascript:alert(1))"),
            "\\[t\\]\\(javascript:alert(1\\))"
        );
        assert_eq!(escape_all_markdown_links("[a](b)c(d)"), "\\[a\\]\\(b\\)c(d)");
    }

    #[test]
    fn leftmost_match_consumes_outer_brackets() {
        assert_eq!(
            escape_all_markdown_links("[[[a](https://x)]]"),
            "\\[[[a\\]\\(https://x\\)]]"
        );
        assert_eq!(
            escape_all_markdown_links("[a[b](https://x)"),
            "\\[a[b\\]\\(https://x\\)"
        );
    }

    #[test]
    fn bang_without_bracket_is_literal() {
        assert_eq!(escape_all_markdown_links("a!b"), "a!b");
        assert_eq!(escape_all_markdown_links("!![a](b)"), "!!\\[a\\]\\(b\\)");
        assert_eq!(escape_obsidian_wikilinks("a!b"), "a!b");
        assert_eq!(escape_obsidian_wikilinks("!![[a]]"), "!!\\[\\[a\\]\\]");
    }

    #[test]
    fn wikilink_stage() {
        assert_eq!(escape_obsidian_wikilinks("[[page]]"), "\\[\\[page\\]\\]");
        assert_eq!(escape_obsidian_wikilinks("![[embed]]"), "!\\[\\[embed\\]\\]");
        assert_eq!(escape_obsidian_wikilinks("[[]]"), "\\[\\[\\]\\]");
        // The wikilink stage does NOT entity-encode.
        assert_eq!(escape_obsidian_wikilinks("[[a]] & <b>"), "\\[\\[a\\]\\] & <b>");
    }

    #[test]
    fn entity_stage_amp_first() {
        assert_eq!(encode_html_entities("&<>"), "&amp;&lt;&gt;");
        // Double-encoding is intended, not a bug.
        assert_eq!(encode_html_entities("&lt;"), "&amp;lt;");
    }

    #[test]
    fn full_chain_order_link_then_entity() {
        assert_eq!(
            sanitize_for_obsidian("[a](https://x/?a=1&b=2)"),
            "\\[a\\]\\(https://x/?a=1&amp;b=2\\)"
        );
        assert_eq!(
            sanitize_for_obsidian("line1 [a](https://x)\nline2 [[w]]\nline3 <b>&</b>"),
            "line1 \\[a\\]\\(https://x\\)\nline2 \\[\\[w\\]\\]\nline3 &lt;b&gt;&amp;&lt;/b&gt;"
        );
    }

    #[test]
    fn multibyte_and_astral_passthrough() {
        assert_eq!(sanitize_for_obsidian("あいう [a](https://x) 🎉"), "あいう \\[a\\]\\(https://x\\) 🎉");
        assert_eq!(sanitize_for_obsidian("Ｈｅｌｌｏ"), "Ｈｅｌｌｏ");
    }

    #[test]
    fn batch_and_join() {
        let inputs = vec!["[a](https://x)".to_string(), "[[w]] &".to_string(), String::new()];
        assert_eq!(
            sanitize_batch(&inputs),
            vec![
                "\\[a\\]\\(https://x\\)".to_string(),
                "\\[\\[w\\]\\] &amp;".to_string(),
                String::new()
            ]
        );
        assert_eq!(
            sanitize_batch_and_join(&inputs, "\n---\n"),
            "\\[a\\]\\(https://x\\)\n---\n\\[\\[w\\]\\] &amp;\n---\n"
        );
        // Newlines inside entries survive the batch contract (the reason the
        // tag-cooccur `\n`-join transfer is NOT reused here).
        let with_nl = vec!["a\nb".to_string()];
        assert_eq!(sanitize_batch(&with_nl), vec!["a\nb".to_string()]);
        assert_eq!(sanitize_batch_and_join(&with_nl, "\n---\n"), "a\nb");
    }
}
