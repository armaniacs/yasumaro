//! PII (personally identifiable information) detection and masking core.
//!
//! Ports the hot-path scanning logic from `src/utils/piiSanitizer.ts` (TS/regex)
//! to a single-pass byte scanner. Covers the five highest-volume pattern types
//! (email, creditCard, myNumber, phoneJp, bankAccount) — the long tail of
//! locale-specific patterns stays in TS since they are cold paths.
//!
//! Matching semantics mirror the TS original's single combined regex
//! (`new RegExp(typeGroups.join('|'), 'g')`) exactly, not just "each pattern
//! type independently, then resolve overlaps by longest span": at every
//! position, JS's regex engine tries alternatives in *source order* (email,
//! then the 3 creditCard sub-patterns, then myNumber, phoneJp, bankAccount)
//! and commits to the first one that matches at that position — it does not
//! try a lower-priority alternative just because a higher-priority one
//! turned out to be Luhn-invalid (Luhn rejection happens after the regex
//! already committed to a creditCard match). Getting this dispatch order
//! and single-attempt-per-position behavior right is what makes this
//! scanner produce byte-identical output to the TS regex, verified against
//! 218 real inputs captured from piiSanitizer.ts's own test suites (see
//! src/wasm/pii-sanitizer/__tests__/parity.test.ts in the main tree).
//!
//! Design mirrors the TS implementation's ReDoS mitigation: any run of
//! non-whitespace bytes longer than `TOKEN_EDGE_KEEP_LEN * 2` has its middle
//! section sampled (window boundaries replaced with `#`) before scanning, so
//! scan cost stays linear in input length regardless of adversarial input.

use serde::Serialize;
use wasm_bindgen::prelude::*;

const TOKEN_EDGE_KEEP_LEN: usize = 100;
const MAX_MATCH_COUNT: usize = 1000;

#[derive(Serialize, Clone)]
pub struct MaskedItem {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub original: String,
    pub index: usize,
}

#[derive(Serialize)]
pub struct SanitizeResult {
    pub text: String,
    #[serde(rename = "maskedItems")]
    pub masked_items: Vec<MaskedItem>,
}

/// Replaces the middle of long non-whitespace runs with a byte class no
/// pattern below can match ('#'), keeping the transformed text the same
/// length as the input so indices from scanning line up 1:1 with `text`.
/// Matches `neutralizeLongNonWhitespaceRuns` / `sampleMiddleForScan` in the
/// TS original.
fn neutralize_long_runs(bytes: &[u8]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    let mut i = 0;
    while i < out.len() {
        if out[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let run_start = i;
        while i < out.len() && !out[i].is_ascii_whitespace() {
            i += 1;
        }
        let run_end = i;
        let run_len = run_end - run_start;
        let threshold = TOKEN_EDGE_KEEP_LEN * 2;
        if run_len > threshold {
            let middle_start = run_start + TOKEN_EDGE_KEEP_LEN;
            let middle_end = run_end - TOKEN_EDGE_KEEP_LEN;
            let mut w = middle_start;
            while w < middle_end {
                let window_end = (w + TOKEN_EDGE_KEEP_LEN).min(middle_end);
                if window_end - w == TOKEN_EDGE_KEEP_LEN {
                    out[window_end - 1] = b'#';
                }
                w = window_end;
            }
        }
    }
    out
}

fn is_word_boundary_before(bytes: &[u8], pos: usize) -> bool {
    pos == 0 || !is_word_byte(bytes[pos - 1])
}

fn is_word_boundary_after(bytes: &[u8], pos: usize) -> bool {
    pos >= bytes.len() || !is_word_byte(bytes[pos])
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_sep(b: u8) -> bool {
    b == b'-' || b == b' '
}

fn take_digits(bytes: &[u8], start: usize, n: usize) -> Option<usize> {
    if start + n > bytes.len() {
        return None;
    }
    if bytes[start..start + n].iter().all(|b| b.is_ascii_digit()) {
        Some(start + n)
    } else {
        None
    }
}

fn luhn_valid(digits: &str) -> bool {
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }
    let mut sum = 0u32;
    let mut even = false;
    for b in digits.bytes().rev() {
        let mut d = (b - b'0') as u32;
        if even {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        even = !even;
    }
    sum % 10 == 0
}

struct Match {
    end: usize,
    kind: &'static str,
}

/// email: [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}
/// Regex semantics: greedily consume the local part forward from `start`,
/// require '@', then a greedily-consumed domain ending in '.' + >=2 alpha.
/// If the domain doesn't satisfy that, there's no backtracking into a
/// shorter local part here (the local-part char class doesn't overlap with
/// what would need to shrink) — the single failure point that matters is
/// "local run doesn't end at '@'", so no `@` within reach means no match.
fn try_email(bytes: &[u8], start: usize) -> Option<Match> {
    fn is_local(b: u8) -> bool {
        b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'%' | b'+' | b'-')
    }
    fn is_domain(b: u8) -> bool {
        b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-')
    }

    if !is_local(bytes[start]) {
        return None;
    }
    let len = bytes.len();
    let mut local_end = start;
    while local_end < len && is_local(bytes[local_end]) {
        local_end += 1;
    }
    if local_end >= len || bytes[local_end] != b'@' {
        return None;
    }
    let domain_start = local_end + 1;
    let mut domain_end = domain_start;
    while domain_end < len && is_domain(bytes[domain_end]) {
        domain_end += 1;
    }
    let domain = &bytes[domain_start..domain_end];
    let dot_rel = domain.iter().rposition(|&b| b == b'.')?;
    let tld = &domain[dot_rel + 1..];
    if tld.len() >= 2 && tld.iter().all(|b| b.is_ascii_alphabetic()) && dot_rel > 0 {
        Some(Match {
            end: domain_end,
            kind: "email",
        })
    } else {
        None
    }
}

fn try_cc_grouped(bytes: &[u8], start: usize) -> Option<usize> {
    // \d{4}([-\s]\d{4}){3}
    let mut pos = take_digits(bytes, start, 4)?;
    for _ in 0..3 {
        if pos >= bytes.len() || !is_sep(bytes[pos]) {
            return None;
        }
        pos += 1;
        pos = take_digits(bytes, pos, 4)?;
    }
    Some(pos)
}

fn try_cc_16(bytes: &[u8], start: usize) -> Option<usize> {
    take_digits(bytes, start, 16)
}

fn try_cc_15(bytes: &[u8], start: usize) -> Option<usize> {
    // \d{4}[-\s]\d{6}[-\s]\d{5}
    let mut pos = take_digits(bytes, start, 4)?;
    if pos >= bytes.len() || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    pos = take_digits(bytes, pos, 6)?;
    if pos >= bytes.len() || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    take_digits(bytes, pos, 5)
}

/// creditCard, tried as 3 sub-patterns in source order (grouped, then 16,
/// then 15) — each is `\b...\b` in the TS source, so a candidate whose span
/// isn't word-bounded is a genuine non-match for that sub-pattern (the
/// regex engine tries the next alternative, same as any failed alternation
/// branch), not a "matched but rejected" case.
///
/// Once a sub-pattern's span IS word-bounded, the regex has committed to it
/// — `match.index`/`lastIndex` are fixed to that span — and Luhn validation
/// runs afterward, in the caller's code, on the already-matched text. A
/// Luhn failure does not un-commit the regex match: it does not fall
/// through to try myNumber or another type at this position, and the next
/// `exec()` call still resumes scanning from this match's end (`lastIndex`
/// only ever advances to the end of whatever the regex matched).
enum CreditCardOutcome {
    /// A sub-pattern matched (word-bounded) and passed Luhn.
    Masked(Match),
    /// A sub-pattern matched (word-bounded) but failed Luhn — the position
    /// is still consumed through `end` (scanning resumes there), just
    /// without emitting a mask.
    RejectedNoFallthrough { end: usize },
    /// No sub-pattern produced a word-bounded match at this position.
    NoMatch,
}

fn try_credit_card(bytes: &[u8], start: usize) -> CreditCardOutcome {
    if !bytes[start].is_ascii_digit() {
        return CreditCardOutcome::NoMatch;
    }
    for candidate_end in [
        try_cc_grouped(bytes, start),
        try_cc_16(bytes, start),
        try_cc_15(bytes, start),
    ] {
        let Some(end) = candidate_end else { continue };
        if !is_word_boundary_after(bytes, end) {
            // This sub-pattern's `\b` failed — try the next alternative,
            // same as the regex engine would.
            continue;
        }
        let digits: String = bytes[start..end]
            .iter()
            .filter(|b| b.is_ascii_digit())
            .map(|&b| b as char)
            .collect();
        return if luhn_valid(&digits) {
            CreditCardOutcome::Masked(Match {
                end,
                kind: "creditCard",
            })
        } else {
            CreditCardOutcome::RejectedNoFallthrough { end }
        };
    }
    CreditCardOutcome::NoMatch
}

/// myNumber: \d{4}[-\s]\d{4}[-\s]\d{4}
fn try_my_number(bytes: &[u8], start: usize) -> Option<Match> {
    let len = bytes.len();
    let mut pos = take_digits(bytes, start, 4)?;
    if pos >= len || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    pos = take_digits(bytes, pos, 4)?;
    if pos >= len || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    let end = take_digits(bytes, pos, 4)?;
    Some(Match {
        end,
        kind: "myNumber",
    })
}

/// phoneJp: 0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}
/// Regex greediness: each `\d{1,4}` group prefers the longest match first,
/// backtracking to shorter only if the rest of the pattern then fails.
fn try_phone_jp(bytes: &[u8], start: usize) -> Option<Match> {
    let len = bytes.len();
    if bytes[start] != b'0' {
        return None;
    }
    // Backtracking order must match the regex engine's: for each `\d{1,4}`,
    // try longest first; for each `[-\s]?`, try "consumed" before "not
    // consumed" (a `?` quantifier is greedy by default). The first fully
    // successful combination — including the trailing `\b` — is the one
    // the regex engine would return, so try combinations in that exact
    // order and return on first success rather than always consuming an
    // optional separator when present (which forecloses the "well-formed
    // match ignoring a run of extra digits after a separator" case, e.g.
    // "090-1234-5678" matching as "090-1234" with sep1 consumed but sep2
    // *not* consumed and g2 falling back to a shorter run).
    for g1 in (1..=4).rev() {
        let pos = match take_digits(bytes, start + 1, g1) {
            Some(p) => p,
            None => continue,
        };
        let sep1_variants: &[usize] = if pos < len && is_sep(bytes[pos]) {
            &[1, 0]
        } else {
            &[0]
        };
        for &sep1 in sep1_variants {
            let pos_after_sep1 = pos + sep1;
            for g2 in (1..=4).rev() {
                let p2 = match take_digits(bytes, pos_after_sep1, g2) {
                    Some(p) => p,
                    None => continue,
                };
                let sep2_variants: &[usize] = if p2 < len && is_sep(bytes[p2]) {
                    &[1, 0]
                } else {
                    &[0]
                };
                for &sep2 in sep2_variants {
                    let p2_after_sep = p2 + sep2;
                    if let Some(end) = take_digits(bytes, p2_after_sep, 4) {
                        if is_word_boundary_after(bytes, end) {
                            return Some(Match {
                                end,
                                kind: "phoneJp",
                            });
                        }
                    }
                }
            }
        }
    }
    None
}

/// bankAccount: \d{7}
fn try_bank_account(bytes: &[u8], start: usize) -> Option<Match> {
    take_digits(bytes, start, 7).map(|end| Match {
        end,
        kind: "bankAccount",
    })
}

/// Single-pass scan reproducing the combined-regex dispatch: at each start
/// position, try alternatives in source order and commit to the first one
/// that matches (word-boundary checked where the TS pattern uses `\b`).
/// A creditCard alternative that matches but fails Luhn still consumes the
/// position (no fallthrough to myNumber/etc — see try_credit_card's doc).
fn scan(bytes: &[u8]) -> Vec<(usize, usize, &'static str)> {
    let len = bytes.len();
    let mut items = Vec::new();
    let mut i = 0;

    while i < len && items.len() <= MAX_MATCH_COUNT {
        if let Some(m) = try_email(bytes, i) {
            items.push((i, m.end, m.kind));
            i = m.end;
            continue;
        }

        if bytes[i].is_ascii_digit() && is_word_boundary_before(bytes, i) {
            match try_credit_card(bytes, i) {
                CreditCardOutcome::Masked(m) => {
                    items.push((i, m.end, m.kind));
                    i = m.end;
                    continue;
                }
                CreditCardOutcome::RejectedNoFallthrough { end } => {
                    // Regex committed to (and consumed) a creditCard
                    // alternative — Luhn failed, so no mask is emitted, but
                    // scanning still resumes from the match's end (matches
                    // lastIndex semantics), not from i+1, and no other type
                    // is tried at this position.
                    i = end;
                    continue;
                }
                CreditCardOutcome::NoMatch => {}
            }

            if let Some(m) = try_my_number(bytes, i) {
                if is_word_boundary_after(bytes, m.end) {
                    items.push((i, m.end, m.kind));
                    i = m.end;
                    continue;
                }
            }

            if bytes[i] == b'0' {
                if let Some(m) = try_phone_jp(bytes, i) {
                    if is_word_boundary_after(bytes, m.end) {
                        items.push((i, m.end, m.kind));
                        i = m.end;
                        continue;
                    }
                }
            }

            if let Some(m) = try_bank_account(bytes, i) {
                if is_word_boundary_after(bytes, m.end) {
                    items.push((i, m.end, m.kind));
                    i = m.end;
                    continue;
                }
            }
        }

        i += 1;
    }

    items
}

/// Runs the full scan/mask pipeline. `text` must be valid UTF-8; all patterns
/// covered here are ASCII, so byte offsets equal char offsets for matched
/// spans, and non-ASCII runs are simply never matched (safe to skip).
fn sanitize_core(text: &str) -> SanitizeResult {
    let bytes = text.as_bytes();
    let scan_bytes = neutralize_long_runs(bytes);

    let spans = scan(&scan_bytes);

    let mut result_text = String::with_capacity(text.len());
    let mut masked_items = Vec::with_capacity(spans.len());
    let mut cursor = 0usize;
    for (start, end, kind) in spans {
        result_text.push_str(&text[cursor..start]);
        let original = text[start..end].to_string();
        result_text.push_str(&format!("[MASKED:{}]", kind));
        masked_items.push(MaskedItem {
            kind,
            original,
            index: start,
        });
        cursor = end;
    }
    result_text.push_str(&text[cursor..]);

    SanitizeResult {
        text: result_text,
        masked_items,
    }
}

/// Sanitizes `text`, returning a JS object `{ text, maskedItems }` matching
/// the shape of `SanitizeResult` in piiSanitizer.ts (minus `error`, which the
/// TS wrapper layers on for size/timeout handling before calling this).
#[wasm_bindgen(js_name = sanitizePii)]
pub fn sanitize_pii(text: &str) -> Result<JsValue, JsValue> {
    let result = sanitize_core(text);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_email() {
        let r = sanitize_core("contact me at user@example.com please");
        assert_eq!(r.text, "contact me at [MASKED:email] please");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "email");
        assert_eq!(r.masked_items[0].original, "user@example.com");
    }

    #[test]
    fn masks_adjacent_emails_without_local_part_bleed() {
        let r = sanitize_core("a@example.comb@example.comc@example.com");
        // Regex `g` semantics: match at pos 0 consumes "a@example.comb"? No —
        // the domain char class [a-zA-Z0-9.-] is greedy and includes letters,
        // so "example.comb" is consumed as domain, then the last '.' + alpha
        // tld check looks at the *last* dot: "example" ".comb" -> tld "comb"
        // is all-alpha, len>=2, so it matches greedily through to "comb".
        // This exact greedy behavior must match the TS regex engine's.
        assert!(r.masked_items[0].original.starts_with("a@example.com"));
    }

    #[test]
    fn masks_valid_credit_card_only() {
        let r = sanitize_core("card 4111-1111-1111-1111 done");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn luhn_invalid_credit_card_consumes_position_without_fallthrough() {
        // Matches TS: the combined regex commits to the creditCard
        // alternative at this position; Luhn rejection does not fall
        // through to myNumber even though "1234-5678-9012" alone would
        // otherwise match myNumber's pattern.
        let r = sanitize_core("card 1234-5678-9012-3456 done");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_my_number() {
        let r = sanitize_core("my number is 1234-5678-9012 ok");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_phone_jp() {
        let r = sanitize_core("call 03-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
    }

    #[test]
    fn phone_jp_backtracks_past_a_trailing_run_of_extra_digits() {
        // The regex backtracks to a shorter match ("090-1234") rather than
        // failing outright, because the trailing "-5678" can't be absorbed
        // by a fixed \d{4} once its own '-' breaks the run — this matches
        // the TS engine exactly (verified via `node -e` against the same
        // regex literal). See try_phone_jp's backtracking-order comment.
        let r = sanitize_core("x/090-1234-5678y");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "090-1234");
    }

    #[test]
    fn masks_bank_account() {
        let r = sanitize_core("account 1234567 ok");
        assert_eq!(r.masked_items[0].kind, "bankAccount");
    }

    #[test]
    fn handles_no_pii() {
        let r = sanitize_core("nothing sensitive here");
        assert_eq!(r.text, "nothing sensitive here");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn neutralizes_long_adversarial_run_without_hanging() {
        let long_run = "a".repeat(200_000);
        let r = sanitize_core(&long_run);
        assert_eq!(r.text.len(), long_run.len());
    }

    #[test]
    fn preserves_indices_across_multiple_matches() {
        let r = sanitize_core("email a@b.co then account 1234567 end");
        assert_eq!(r.masked_items.len(), 2);
        assert!(r.masked_items[0].index < r.masked_items[1].index);
    }
}
