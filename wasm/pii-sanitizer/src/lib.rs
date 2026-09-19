//! PII (personally identifiable information) detection and masking core.
//!
//! Ports all 21 pattern types from `PII_PATTERNS` in `src/utils/piiSanitizer.ts`
//! (TS/regex) to a single-pass byte scanner: the 5 highest-volume ones
//! (email, creditCard, myNumber, phoneJp, bankAccount — see `patterns/core5.rs`)
//! plus the 16 locale-specific ones (driverLicense, jpPassport, ipv4, ipv6,
//! ssn, phoneUs, phoneCn, idCn, rrnKr, phoneKr, iban, deTaxId, frInsee,
//! itCodiceFiscale, esDni, esNie — see `patterns/extended.rs`).
//!
//! Matching semantics mirror the TS original's single combined regex
//! (`new RegExp(typeGroups.join('|'), 'g')`) exactly, not just "each pattern
//! type independently, then resolve overlaps by longest span": at every
//! position, JS's regex engine tries alternatives in *source order* and
//! commits to the first one that matches at that position — it does not try
//! a lower-priority alternative just because a higher-priority one turned
//! out to be Luhn-invalid (Luhn rejection happens after the regex already
//! committed to a creditCard match). Getting this dispatch order and
//! single-attempt-per-position behavior right (see `patterns/dispatch.rs`)
//! is what makes this scanner produce byte-identical output to the TS
//! regex, verified against 218 real inputs captured from piiSanitizer.ts's
//! own test suites (see src/wasm/pii-sanitizer/__tests__/parity.test.ts in
//! the main tree).
//!
//! Design mirrors the TS implementation's ReDoS mitigation: any run of
//! non-whitespace bytes longer than `TOKEN_EDGE_KEEP_LEN * 2` has its middle
//! section sampled (window boundaries replaced with `#`) before scanning, so
//! scan cost stays linear in input length regardless of adversarial input.

mod patterns;

use serde::Serialize;
use wasm_bindgen::prelude::*;

const TOKEN_EDGE_KEEP_LEN: usize = 100;

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
    // Run boundaries follow JS \s (the TS reference tokenizes with /\S+/),
    // which includes the multi-byte whitespace members (U+3000 etc.) — a
    // full-width space must split the run exactly where the regex engine's
    // \S+ does, or the sampled windows would diverge from the TS scan.
    while i < out.len() {
        let ws = patterns::common::js_ws_len(&out, i);
        if ws > 0 {
            i += ws;
            continue;
        }
        let run_start = i;
        while i < out.len() && patterns::common::js_ws_len(&out, i) == 0 {
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

/// Runs the full scan/mask pipeline. `text` must be valid UTF-8; all patterns
/// covered here are ASCII, so byte offsets equal char offsets for matched
/// spans, and non-ASCII runs are simply never matched (safe to skip).
///
/// Note for JS consumers of `maskedItems[].index`: it is a byte offset into
/// the UTF-8 input, while `sanitizeRegex`'s `match.index` is a UTF-16 code
/// unit offset — the two agree only when all preceding text is ASCII.
fn sanitize_core(text: &str) -> Result<SanitizeResult, patterns::dispatch::MatchLimitExceeded> {
    let bytes = text.as_bytes();
    let scan_bytes = neutralize_long_runs(bytes);

    let spans = patterns::dispatch::scan(&scan_bytes)?;

    let mut result_text = String::with_capacity(text.len());
    let mut masked_items = Vec::with_capacity(spans.len());
    let mut cursor = 0usize;
    for (start, end, kind) in spans {
        result_text.push_str(&text[cursor..start]);
        let original = text[start..end].to_string();
        result_text.push_str("[MASKED:");
        result_text.push_str(kind);
        result_text.push(']');
        masked_items.push(MaskedItem {
            kind,
            original,
            index: start,
        });
        cursor = end;
    }
    result_text.push_str(&text[cursor..]);

    Ok(SanitizeResult {
        text: result_text,
        masked_items,
    })
}

/// Sanitizes `text`, returning a JS object `{ text, maskedItems }` matching
/// the shape of `SanitizeResult` in piiSanitizer.ts (minus `error`, which the
/// TS wrapper layers on for size/timeout handling before calling this).
///
/// Exceeding the match-count cap rejects with the same message the TS scan
/// throws, so the hybrid's fallback lands in `sanitizeRegex` and fails closed
/// exactly like the pre-WASM pipeline did.
#[wasm_bindgen(js_name = sanitizePii)]
pub fn sanitize_pii(text: &str) -> Result<JsValue, JsValue> {
    let result = sanitize_core(text).map_err(|_| {
        JsValue::from_str("Operation exceeded maximum match count of 1000")
    })?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test helper: unwraps the match-limit Result so existing assertions
    /// stay one-liners. Tests that exercise the limit call sanitize_core
    /// directly.
    fn core(text: &str) -> SanitizeResult {
        sanitize_core(text).expect("match limit should not be hit")
    }

    #[test]
    fn masks_email() {
        let r = core("contact me at user@example.com please");
        assert_eq!(r.text, "contact me at [MASKED:email] please");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "email");
        assert_eq!(r.masked_items[0].original, "user@example.com");
    }

    #[test]
    fn masks_adjacent_emails_without_local_part_bleed() {
        let r = core("a@example.comb@example.comc@example.com");
        assert!(r.masked_items[0].original.starts_with("a@example.com"));
    }

    #[test]
    fn masks_valid_credit_card_only() {
        let r = core("card 4111-1111-1111-1111 done");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn luhn_invalid_credit_card_consumes_position_without_fallthrough() {
        let r = core("card 1234-5678-9012-3456 done");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_my_number() {
        let r = core("my number is 1234-5678-9012 ok");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_phone_jp() {
        let r = core("call 03-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
    }

    #[test]
    fn phone_jp_backtracks_past_a_trailing_run_of_extra_digits() {
        let r = core("x/090-1234-5678y");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "090-1234");
    }

    #[test]
    fn masks_bank_account() {
        let r = core("account 1234567 ok");
        assert_eq!(r.masked_items[0].kind, "bankAccount");
    }

    #[test]
    fn handles_no_pii() {
        let r = core("nothing sensitive here");
        assert_eq!(r.text, "nothing sensitive here");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn neutralizes_long_adversarial_run_without_hanging() {
        let long_run = "a".repeat(200_000);
        let r = core(&long_run);
        assert_eq!(r.text.len(), long_run.len());
    }

    #[test]
    fn preserves_indices_across_multiple_matches() {
        let r = core("email a@b.co then account 1234567 end");
        assert_eq!(r.masked_items.len(), 2);
        assert!(r.masked_items[0].index < r.masked_items[1].index);
    }

    // --- Extended (16 locale-specific) pattern tests ---

    #[test]
    fn masks_driver_license() {
        let r = core("license 123456789012 ok");
        assert_eq!(r.masked_items[0].kind, "driverLicense");
    }

    #[test]
    fn masks_jp_passport() {
        let r = core("passport AB1234567 ok");
        assert_eq!(r.masked_items[0].kind, "jpPassport");
    }

    #[test]
    fn masks_ipv4_private_range() {
        let r = core("server at 192.168.1.1 today");
        assert_eq!(r.masked_items[0].kind, "ipv4");
        assert_eq!(r.masked_items[0].original, "192.168.1.1");
    }

    #[test]
    fn masks_ipv4_10_range() {
        let r = core("internal 10.0.0.1 host");
        assert_eq!(r.masked_items[0].kind, "ipv4");
    }

    #[test]
    fn masks_ipv4_172_range() {
        let r = core("internal 172.16.0.1 host");
        assert_eq!(r.masked_items[0].kind, "ipv4");
    }

    #[test]
    fn does_not_mask_public_ipv4() {
        let r = core("public 8.8.8.8 dns");
        assert!(r.masked_items.iter().all(|m| m.kind != "ipv4"));
    }

    #[test]
    fn masks_ipv6() {
        let r = core("addr 2001:0db8:0000:0000:0000:ff00:0042:8329 end");
        assert_eq!(r.masked_items[0].kind, "ipv6");
    }

    #[test]
    fn masks_ssn() {
        let r = core("ssn 123-45-6789 on file");
        assert_eq!(r.masked_items[0].kind, "ssn");
    }

    #[test]
    fn masks_phone_us_with_parens() {
        let r = core("call (555) 123-4567 now");
        assert_eq!(r.masked_items[0].kind, "phoneUs");
    }

    #[test]
    fn masks_phone_us_with_country_code() {
        let r = core("call +1-555-123-4567 now");
        assert_eq!(r.masked_items[0].kind, "phoneUs");
    }

    #[test]
    fn masks_phone_cn() {
        let r = core("call 13812345678 now");
        assert_eq!(r.masked_items[0].kind, "phoneCn");
    }

    #[test]
    fn masks_phone_cn_with_country_code() {
        let r = core("call +86-13812345678 now");
        assert_eq!(r.masked_items[0].kind, "phoneCn");
    }

    #[test]
    fn masks_id_cn() {
        let r = core("id 110101199003076789 ok");
        assert_eq!(r.masked_items[0].kind, "idCn");
    }

    #[test]
    fn masks_id_cn_with_trailing_x() {
        let r = core("id 11010119900307678X ok");
        assert_eq!(r.masked_items[0].kind, "idCn");
    }

    #[test]
    fn masks_rrn_kr() {
        let r = core("rrn 901231-1234567 ok");
        assert_eq!(r.masked_items[0].kind, "rrnKr");
    }

    #[test]
    fn masks_phone_kr() {
        // "010-1234-5678" alone matches phoneJp first (0-prefixed patterns
        // are defined earlier in PII_PATTERNS and phoneJp's pattern matches
        // it too — verified against TS: sanitizeRegex('call 010-1234-5678')
        // returns type "phoneJp", not "phoneKr"). Use the +82 country-code
        // prefix to unambiguously exercise phoneKr's own pattern.
        let r = core("call +82-10-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneKr");
    }

    #[test]
    fn masks_iban_de() {
        let r = core("iban DE89370400440532013000 ok");
        assert_eq!(r.masked_items[0].kind, "iban");
    }

    #[test]
    fn masks_iban_fr() {
        let r = core("iban FR1420041010050500013M02606 ok");
        assert_eq!(r.masked_items[0].kind, "iban");
    }

    #[test]
    fn masks_de_tax_id() {
        let r = core("tax id 12345678901 ok");
        assert_eq!(r.masked_items[0].kind, "deTaxId");
    }

    #[test]
    fn masks_fr_insee() {
        let r = core("insee 123456789012345 ok");
        assert_eq!(r.masked_items[0].kind, "frInsee");
    }

    #[test]
    fn masks_it_codice_fiscale() {
        let r = core("cf RSSMRA85M01H501Z ok");
        assert_eq!(r.masked_items[0].kind, "itCodiceFiscale");
    }

    #[test]
    fn masks_es_dni() {
        let r = core("dni 12345678Z ok");
        assert_eq!(r.masked_items[0].kind, "esDni");
    }

    #[test]
    fn masks_es_nie() {
        let r = core("nie X1234567L ok");
        assert_eq!(r.masked_items[0].kind, "esNie");
    }

    // --- Separator-class parity (`[-\s]` must accept the full ASCII
    // whitespace set, not just space/tab) and ipv6 hex-leading starts ---

    #[test]
    fn masks_phone_jp_split_across_newlines() {
        let r = core("call 03\n1234\n5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "03\n1234\n5678");
    }

    #[test]
    fn masks_phone_jp_separated_by_ideographic_space() {
        // U+3000 (full-width space) is a JS \s member: the TS reference masks
        // full-width-formatted numbers, so the scanner must consume its 3
        // UTF-8 bytes as one separator.
        let r = core("TEL 03\u{3000}1234\u{3000}5678 です");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "03\u{3000}1234\u{3000}5678");
    }

    #[test]
    fn masks_my_number_separated_by_ideographic_space() {
        let r = core("マイナンバー 1234\u{3000}5678\u{3000}9012 確認");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_credit_card_separated_by_nbsp() {
        // U+00A0 (2-byte UTF-8) — a different width class than U+3000.
        let r = core("card 4111\u{00a0}1111\u{00a0}1111\u{00a0}1111 done");
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn masks_phone_jp_separated_by_mixed_ws_widths() {
        // Mixed widths across the two separator slots: U+3000 then U+00A0.
        let r = core("03\u{3000}1234\u{00a0}5678");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
    }

    #[test]
    fn trailing_multibyte_separator_does_not_match_or_panic() {
        // "03　1234　" ends with a complete U+3000: phoneJp needs a third
        // digit group after it, so there is no match — the width-aware
        // separator consumption must not over-read or panic at the end of
        // input.
        let r = core("03\u{3000}1234\u{3000}");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_my_number_split_across_newlines() {
        let r = core("my number is 1234\n5678\n9012 ok");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_credit_card_split_across_newlines() {
        let r = core("card 4111\n1111\n1111\n1111 done");
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn does_not_mask_ssn_split_across_newlines() {
        // Parity pin, not a gap: the TS ssn pattern uses literal hyphens
        // (/\b\d{3}-\d{2}-\d{4}\b/), not [-\s], so newline-separated input
        // is unmasked on BOTH sides.
        let r = core("ssn 123\n45\n6789 on file");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_ipv6_starting_with_hex_letter() {
        // The TS ipv6 char class is [0-9a-fA-F], so addresses starting with a
        // hex letter must dispatch the same way digit-leading ones do.
        let r = core("addr fe80:0000:0000:0000:0000:0000:0000:0001 end");
        assert_eq!(r.masked_items[0].kind, "ipv6");
        assert_eq!(r.masked_items[0].original, "fe80:0000:0000:0000:0000:0000:0000:0001");
    }

    // --- Match-count cap: must fail closed like the TS reference ---

    #[test]
    fn exactly_1000_matches_still_succeeds() {
        // 1000 bank-account matches (7 digits each) stay under the cap: the
        // TS scan throws only when matchCount exceeds 1000.
        let text = "account 1234567\n".repeat(1000);
        let r = sanitize_core(&text).expect("exactly 1000 matches must not exceed the cap");
        assert_eq!(r.masked_items.len(), 1000);
    }

    #[test]
    fn exceeding_1000_matches_reports_match_limit() {
        let text = "account 1234567\n".repeat(1001);
        assert!(sanitize_core(&text).is_err());
    }
}
